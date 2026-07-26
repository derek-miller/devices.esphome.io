/**
 * Build-time index behind the device browser.
 *
 * Produces one card per device — title, thumbnail, and every facet value —
 * plus a separate bag of search tokens. Both are served as static JSON
 * (src/pages/device-index.json.ts and device-search-text.json.ts) so the
 * browser fetches them once and caches them across every listing page,
 * rather than each page inlining its own copy.
 *
 * Thumbnails come from the same images the markdown already references.
 * Astro only optimizes images a component imports, so the whole device image
 * tree is pulled in with import.meta.glob and the chosen hero is run through
 * getImage() at ~320px — small enough that a 774-card grid stays light.
 */
import { getImage } from "astro:assets";
import { getCollection, type CollectionEntry } from "astro:content";
import {
  buildFacetValues,
  deriveBrands,
  stripCodeBlocks,
  type DeviceFacetValues,
} from "./deviceFacets";
import type { RawDeviceMetadata } from "./deviceUtils";

/** Every image under src/docs/devices/, as Astro image metadata. */
const DEVICE_IMAGES = import.meta.glob<{ default: ImageMetadata }>(
  "../docs/devices/**/*.{jpg,jpeg,JPG,JPEG,png,PNG,webp,WEBP}",
  { eager: true }
);

const THUMBNAIL_WIDTH = 320;

export type DeviceCard = {
  id: string;
  title: string;
  path: string;
  /** Optimized thumbnail, absent when the device has no usable image. */
  thumb?: { src: string; width: number; height: number };
  date: string | null;
  facets: DeviceFacetValues;
};

export type DeviceIndex = {
  cards: DeviceCard[];
  /** Facet id -> value -> number of devices, over the whole catalog. */
  counts: Record<string, Record<string, number>>;
  /** Device id -> search tokens, served separately by device-search-text.json. */
  text: DeviceSearchText;
};

const IMAGE_MARKDOWN = /!\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const IMAGE_HTML = /<img[^>]+src=["']([^"']+)["']/gi;

function isRemote(url: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("data:");
}

/** Local image paths referenced by the page, in document order. */
function referencedImages(body: string): string[] {
  const found: string[] = [];
  for (const pattern of [IMAGE_MARKDOWN, IMAGE_HTML]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const url = match[1].split("#")[0].split("?")[0];
      if (url && !isRemote(url)) found.push(url);
    }
  }
  return found;
}

/**
 * The device's folder name as it exists on disk.
 *
 * Collection ids are lowercased ("athom-smart-plug-tp29") while the folders
 * keep their original casing ("Athom-Smart-Plug-TP29"), and the image glob is
 * keyed by real paths — so image lookups have to go through filePath.
 */
export function deviceFolder(filePath: string | undefined, id: string): string {
  const match = /(?:^|\/)docs\/devices\/([^/]+)\//.exec(filePath ?? "");
  return match ? match[1] : id;
}

function globKey(slug: string, relativePath: string): string {
  const cleaned = relativePath.replace(/^\.\//, "");
  // Filenames with spaces are percent-encoded in markdown but not on disk.
  let decoded = cleaned;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    // Malformed escape sequence: fall back to the raw path.
  }
  return `../docs/devices/${slug}/${decoded}`;
}

/**
 * Pick the image that best represents a device: the first one the page shows,
 * falling back to any image sitting in the device folder (a handful of pages
 * ship photos they never reference).
 */
function heroImage(slug: string, body: string): ImageMetadata | null {
  for (const relativePath of referencedImages(body)) {
    const image = DEVICE_IMAGES[globKey(slug, relativePath)];
    if (image) return image.default;
  }

  const prefix = `../docs/devices/${slug}/`;
  const inFolder = Object.keys(DEVICE_IMAGES)
    .filter((key) => key.startsWith(prefix))
    .sort();
  return inFolder.length > 0 ? DEVICE_IMAGES[inFolder[0]].default : null;
}

/**
 * Example configs stored alongside a device page, as raw text.
 *
 * Newly added devices are required to keep their yaml in its own file and
 * pull it in with a `file=` fence (see .github/PULL_REQUEST_TEMPLATE.md), so
 * reading only the inline fences would make the facets go quiet as the
 * catalog migrates to that convention.
 */
const DEVICE_CONFIGS = import.meta.glob<string>(
  "../docs/devices/**/*.{yaml,yml}",
  { eager: true, query: "?raw", import: "default" }
);

// Mirrors the attribute forms handled by src/integrations/remark-yaml-include.ts.
const FILE_ATTR = /(?:^|\s)file=(?:"([^"]+)"|'([^']+)'|([^\s"']+))/;
const URL_ATTR = /(?:^|\s)url=(?:"([^"]+)"|'([^']+)'|([^\s"']+))/;

type DeviceConfig = {
  /** Inline yaml plus the contents of any `file=` includes. */
  yamlText: string;
  /** The page points at a config hosted elsewhere (a `url=` fence). */
  external: boolean;
};

function attributeValue(pattern: RegExp, meta: string): string | null {
  const match = pattern.exec(meta);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function deviceConfig(folder: string, body: string): DeviceConfig {
  const blocks: string[] = [];
  let external = false;

  const fence = /```ya?ml([^\n]*)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(body)) !== null) {
    const [, meta, content] = match;
    const file = attributeValue(FILE_ATTR, meta);
    if (file) {
      const included = DEVICE_CONFIGS[globKey(folder, file)];
      if (included) blocks.push(included);
      continue;
    }
    if (attributeValue(URL_ATTR, meta)) {
      external = true;
      continue;
    }
    blocks.push(content);
  }

  return { yamlText: blocks.join("\n"), external };
}

function isDeviceEntry(entry: CollectionEntry<"docs">): boolean {
  return (
    entry.id.startsWith("devices/") &&
    entry.id !== "devices/adding-devices" &&
    entry.id !== "devices/tuya-convert"
  );
}

let cached: Promise<DeviceIndex> | null = null;

/**
 * Assemble the index. Memoized because several pages ask for it during one
 * build and the image work is the expensive part.
 */
export function getDeviceIndex(): Promise<DeviceIndex> {
  cached ??= buildDeviceIndex();
  return cached;
}

async function buildDeviceIndex(): Promise<DeviceIndex> {
  const entries = (await getCollection("docs")).filter(isDeviceEntry);
  const brands = deriveBrands(entries.map((entry) => entry.data.title));

  const text: DeviceSearchText = {};

  const cards = await Promise.all(
    entries.map(async (entry): Promise<DeviceCard> => {
      const id = entry.id.replace(/^devices\//, "");
      const data = entry.data as unknown as RawDeviceMetadata;
      const body = entry.body ?? "";

      const folder = deviceFolder(entry.filePath, id);
      const config = deviceConfig(folder, body);
      const image = heroImage(folder, body);
      const thumb = image
        ? await getImage({
            src: image,
            width: Math.min(THUMBNAIL_WIDTH, image.width),
            format: "webp",
            quality: 62,
          })
        : null;

      // Included yaml is searchable too, so a chip named only in a `file=`
      // config still turns up.
      text[id] = searchTokens(data.title, `${body}\n${config.yamlText}`);

      return {
        id,
        title: data.title,
        path: `/devices/${id}/`,
        ...(thumb
          ? {
              thumb: {
                src: thumb.src,
                width: Number(thumb.attributes.width),
                height: Number(thumb.attributes.height),
              },
            }
          : {}),
        date: data["date-published"] ?? null,
        facets: buildFacetValues({
          data,
          brand: brands.get(data.title) ?? null,
          yamlText: config.yamlText,
          externalConfig: config.external,
          prose: stripCodeBlocks(body),
          hasImage: image !== null,
        }),
      };
    })
  );

  cards.sort((a, b) => a.title.localeCompare(b.title));

  const counts: Record<string, Record<string, number>> = {};
  for (const card of cards) {
    for (const [facet, values] of Object.entries(card.facets)) {
      const bucket = (counts[facet] ??= {});
      for (const value of values) bucket[value] = (bucket[value] ?? 0) + 1;
    }
  }

  return { cards, counts, text };
}

// ---------------------------------------------------------------------------
// Full-text tokens
// ---------------------------------------------------------------------------

/**
 * Words too common across the corpus to narrow anything down. Every page has
 * a wifi block and an api block, so matching them just returns everything.
 */
const STOPWORDS = new Set([
  "and", "api", "are", "as", "at", "be", "board", "but", "by", "can",
  "captive_portal", "config", "configuration", "device", "esphome", "for",
  "from", "has", "have", "here", "home", "id", "if", "in", "is", "it", "logger",
  "name", "not", "of", "on", "ota", "or", "password", "platform", "port", "run",
  "secret", "smart", "ssid", "that", "the", "this", "to", "true", "use", "using",
  "版", "with", "wifi", "you", "your", "yaml", "esp", "http", "https", "www",
  "com", "png", "jpg", "jpeg", "webp", "img", "image", "alt", "html", "md",
]);

/**
 * Tokens for one device, deduplicated. Dedup matters: the raw bodies total
 * ~3.8 MB, most of it repeated yaml keys, and unique tokens cut that to a
 * fraction while supporting exactly the same substring queries.
 */
export function searchTokens(title: string, body: string): string {
  const tokens = new Set<string>();
  for (const raw of `${title}\n${body}`.toLowerCase().split(/[^a-z0-9_.+-]+/)) {
    const token = raw.replace(/^[.\-+_]+|[.\-+_]+$/g, "");
    if (token.length < 2 || token.length > 32) continue;
    if (STOPWORDS.has(token)) continue;
    if (/^\d+$/.test(token) && token.length > 4) continue; // stray long numbers
    tokens.add(token);
  }
  return [...tokens].sort().join(" ");
}

export type DeviceSearchText = Record<string, string>;
