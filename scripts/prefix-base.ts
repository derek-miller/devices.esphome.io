/**
 * Rewrite root-absolute URLs in a built site so it can be served from a
 * sub-path, e.g. a GitHub Pages project site at
 * https://<user>.github.io/<repo>/.
 *
 * Only needed for preview deploys: the production Netlify site is served
 * from the domain root, where nothing here applies. Used by the
 * `preview_pages` workflow (.github/workflows/deploy-pages.yml):
 *
 *   npx tsx scripts/prefix-base.ts dist /devices.esphome.io
 *   npx tsx scripts/prefix-base.ts dist /devices.esphome.io --check
 *
 * Astro's own `base` option (wired to $SITE_BASE in astro.config.mjs)
 * already prefixes everything Astro and Starlight generate — page routes,
 * asset URLs, the Pagefind bundle. What it cannot know about are
 * hand-written root-absolute paths in components and device markdown, of
 * which this repo has plenty:
 *
 *   src/components/DeviceListItem.astro   ->  href="/type/plug"
 *   src/utils/getDevices.ts               ->  "/devices/<slug>/"
 *   41 device markdown files              ->  [text](/devices/<slug>)
 *
 * Rather than thread a base-aware URL helper through every call site, this
 * runs over the built output and prefixes the leftovers.
 *
 * Substitution is deliberately conservative: a path is only rewritten when
 * its first segment names a real top-level entry in the built site (`/type`,
 * `/devices`, `/img`, `/_astro`, …), and only when preceded by a delimiter
 * (quote, paren, comma, whitespace) so URLs embedded in a host — such as
 * https://devices.esphome.io/img/x.png — are left alone. Paths Astro has
 * already prefixed start with the base segment, which is not a top-level
 * entry of the build, so they are never touched twice.
 *
 * Exits 0 on success, 1 if --check finds files that still need rewriting.
 */
import * as fs from "fs";
import * as path from "path";

// Text formats that can carry a URL: markup, stylesheets, bundled scripts,
// JSON data (our search index, Pagefind fragments), sitemaps and robots.
const REWRITABLE_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".xml",
  ".svg",
  ".txt",
]);

// A URL may only be rewritten when the character before its leading slash is
// one of these. Excluding word characters is what keeps
// "https://host/devices/x" — where `t` precedes `/devices` — from matching.
const DELIMITER_BEFORE = `(?<![\\w.\\-~])`;

// ...and the character after the matched segment must end it, so `/devices`
// does not match inside the already-prefixed `/devices.esphome.io/...`.
const DELIMITER_AFTER = `(?=[/"'\\\`)\\s,;>?#\\\\]|$)`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (REWRITABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Top-level names of the built site — the only path prefixes we rewrite.
 * Derived from the build itself rather than hard-coded so new routes and
 * new public/ files are covered automatically.
 */
function topLevelSegments(distDir: string): string[] {
  return fs
    .readdirSync(distDir, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => name !== "_redirects")
    .sort((a, b) => b.length - a.length);
}

function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const [distArg, baseArg] = args.filter((a) => !a.startsWith("--"));

  if (!distArg || baseArg === undefined) {
    console.error(
      "Usage: tsx scripts/prefix-base.ts <dist-dir> <base-path> [--check]"
    );
    process.exit(1);
  }

  const distDir = path.resolve(distArg);
  const base = normalizeBase(baseArg);

  if (!fs.existsSync(distDir)) {
    console.error(`Build directory not found: ${distDir}`);
    process.exit(1);
  }

  if (!base) {
    console.log("Base path is empty or '/', nothing to rewrite.");
    return;
  }

  const segments = topLevelSegments(distDir);
  if (segments.length === 0) {
    console.error(`No top-level entries found in ${distDir}`);
    process.exit(1);
  }

  const pattern = new RegExp(
    `${DELIMITER_BEFORE}/(${segments.map(escapeRegExp).join("|")})${DELIMITER_AFTER}`,
    "g"
  );
  // Root links (`href="/"`, `src='/'`) need the base too, but a bare "/" is
  // too common to rewrite blind — only attribute values that are exactly "/".
  const rootAttrPattern = /(\s(?:href|src|action)=)(["'])\/\2/g;

  const files = collectFiles(distDir);
  let changedFiles = 0;
  let replacements = 0;
  const byExtension = new Map<string, number>();

  for (const file of files) {
    const original = fs.readFileSync(file, "utf8");
    let updated = original.replace(pattern, (_match, segment: string) => {
      replacements++;
      return `${base}/${segment}`;
    });
    updated = updated.replace(rootAttrPattern, (_match, attr: string, quote: string) => {
      replacements++;
      return `${attr}${quote}${base}/${quote}`;
    });

    if (updated === original) continue;

    changedFiles++;
    const ext = path.extname(file).toLowerCase();
    byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1);
    if (!check) fs.writeFileSync(file, updated);
  }

  const summary = [...byExtension.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => `${count} ${ext}`)
    .join(", ");

  if (check) {
    if (changedFiles === 0) {
      console.log(`No root-absolute URLs need rewriting under ${base}.`);
      return;
    }
    console.error(
      `${changedFiles} file(s) still contain root-absolute URLs (${replacements} occurrence(s)): ${summary}`
    );
    process.exit(1);
  }

  console.log(
    `Prefixed ${replacements} URL(s) with ${base} across ${changedFiles} of ${files.length} file(s)${
      summary ? ` (${summary})` : ""
    }.`
  );
}

main();
