/**
 * Facet extraction for the device browser (src/components/DeviceBrowser.astro).
 *
 * Everything here is pure and runs at build time. Three sources feed it:
 *
 *   frontmatter  type, standard, board, difficulty, made-for-esphome,
 *                project-url, date-published — authoritative but inconsistent
 *                (case variants, comma lists, a few key typos), so every
 *                reader below normalizes rather than trusting the raw value.
 *   yaml         the fenced config blocks on each page. Top-level keys and
 *                `platform:` values say what a device actually *is*
 *                (power monitoring, IR remote, display, …) far more precisely
 *                than `type: misc` does.
 *   prose        install/flash method, which is only ever stated in prose.
 *
 * Brands are derived from titles rather than a curated list — see
 * deriveBrands() — so the facet keeps working as devices are added upstream
 * without anyone maintaining a mapping table here.
 */
import { splitValues, slugify, type RawDeviceMetadata } from "./deviceUtils";
import {
  VALID_TYPES,
  VALID_BOARDS,
  VALID_STANDARDS,
} from "./validFrontmatter";

/** Frontmatter keys that exist misspelled or miscased on real pages. */
const KEY_ALIASES: Record<string, readonly string[]> = {
  board: ["board", "boaard"],
  difficulty: ["difficulty", "Difficulty"],
  "made-for-esphome": [
    "made-for-esphome",
    "Made-for-esphome",
    "made-for-esp-home",
  ],
  model: ["model", "Model"],
};

function readField(data: RawDeviceMetadata, field: string): unknown {
  for (const key of KEY_ALIASES[field] ?? [field]) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * Standards seen in frontmatter that are not in VALID_STANDARDS. They have no
 * listing page to link to, but they are still real information, so the facet
 * keeps them instead of dropping the device's only standard on the floor.
 */
const EXTRA_STANDARD_LABELS: Record<string, string> = {
  ch: "CH",
  il: "IL",
  it: "IT",
  nz: "NZ",
};

const STANDARD_LABELS: Record<string, string> = {
  au: "AU",
  br: "BR",
  eu: "EU",
  global: "Global",
  in: "IN",
  uk: "UK",
  us: "US",
  ...EXTRA_STANDARD_LABELS,
};

const TYPE_LABELS: Record<string, string> = {
  dimmer: "Dimmer",
  light: "Light / LED",
  misc: "Miscellaneous",
  plug: "Plug / Socket",
  relay: "Relay",
  sensor: "Sensor",
  switch: "Switch",
};

const BOARD_LABELS: Record<string, string> = {
  bk72xx: "BK72xx",
  esp32: "ESP32",
  esp8266: "ESP8266",
  ln882x: "LN882x",
  rp2040: "RP2040",
  rtl87xx: "RTL87xx",
};

/**
 * Difficulty wording matches src/components/FrontmatterDisplay.astro so the
 * facet and the device page describe a level the same way.
 */
const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Comes with ESPHome",
  2: "Plug-n-flash",
  3: "Disassembly required",
  4: "Soldering required",
  5: "Chip needs replacement",
};

export function normalizeType(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = slugify(raw);
  return VALID_TYPES.has(value) ? value : null;
}

export function normalizeBoards(raw: unknown): string[] {
  return splitValues(raw as string | string[] | undefined)
    .map((value) => slugify(value))
    .filter((value) => VALID_BOARDS.has(value));
}

export function normalizeStandards(raw: unknown): string[] {
  return splitValues(raw as string | string[] | undefined)
    .map((value) => slugify(value))
    .filter(
      (value) => VALID_STANDARDS.has(value) || value in EXTRA_STANDARD_LABELS
    );
}

export function normalizeDifficulty(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

export function isMadeForEsphome(raw: unknown): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

/** Longest brand, in tokens, deriveBrands() will infer from a title. */
const MAX_BRAND_TOKENS = 3;

/** Key that folds casing and punctuation, so "TP-Link" == "TP Link". */
function brandKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function titleTokens(title: string): string[] {
  return title.trim().split(/\s+/).filter(Boolean);
}

/**
 * Leading words that describe the product rather than who made it. Titles
 * starting with one of these ("Smart Plant", "RGB Smart Plug 16A") would
 * otherwise mint a brand called "Smart" or "RGB".
 */
const NOT_A_BRAND = new Set([
  "smart", "generic", "diy", "universal", "cheap", "unbranded", "no-name",
  "rgb", "rgbw", "rgbww", "rgbcw", "cct", "led", "leds", "light", "lights",
  "wifi", "wi-fi", "ble", "bluetooth", "zigbee", "usb", "ir", "rf", "ac", "dc",
  "mini", "micro", "dual", "triple", "quad", "single", "double",
  "indoor", "outdoor", "wireless", "wall", "ceiling", "desk", "table",
  "digital", "electric", "electronic", "portable", "rotary", "doorbell",
  "geiger", "hat", "status", "surface-mounted", "in-wall", "inline",
  "the", "a", "an", "my", "diy/community",
]);

/**
 * Measurements and bare model codes: "15W", "16A", "3.5mm", "A70", "T2".
 * Never a manufacturer, and common as the first word of a title.
 */
function isSpecToken(token: string): boolean {
  return (
    /^\d+(?:\.\d+)?(?:w|watt|watts|a|amp|amps|v|k|ch|gang|way|mm|cm|m|in|inch|ft|pcs|x)?$/i.test(
      token
    ) || /^[a-z]{1,2}\d+[a-z]{0,2}$/i.test(token)
  );
}

function isBrandlessToken(token: string): boolean {
  return NOT_A_BRAND.has(token.toLowerCase()) || isSpecToken(token);
}

/**
 * Infer each title's brand from the whole corpus of titles.
 *
 * A single leading token is the brand for most devices ("Athom Smart Plug
 * TP29" -> Athom). Multi-word brands are found by extension: if every device
 * whose title starts with "Martin" continues with "Jerry", then "Martin
 * Jerry" is the brand. "Athom" is followed by Smart, Energy, PG05, … so it
 * stops at one token. Devices that are alone under their leading token keep
 * that token, since there is no evidence for a longer name.
 *
 * Titles that open with a spec or a generic word are looked up instead: "15W
 * A70 Mirabella Genio White Bulb" finds Mirabella further along, because
 * other titles do start with it. A title with nothing brand-like in it gets
 * no brand at all rather than an invented one.
 *
 * Returns a map of title -> display brand, with titles left out when no
 * brand could be established.
 */
export function deriveBrands(titles: readonly string[]): Map<string, string> {
  // How many titles start with a given (normalized) token prefix, and what
  // the next token is for each of them. Titles opening with a spec or generic
  // word contribute nothing here — they are the ones needing a lookup.
  const groups = new Map<string, { titles: number; next: Set<string> }>();

  for (const title of titles) {
    const tokens = titleTokens(title);
    if (tokens.length === 0 || isBrandlessToken(tokens[0])) continue;
    for (let length = 1; length <= Math.min(MAX_BRAND_TOKENS, tokens.length); length++) {
      const key = brandKey(tokens.slice(0, length).join(" "));
      if (!key) continue;
      const group = groups.get(key) ?? { titles: 0, next: new Set<string>() };
      group.titles++;
      const next = tokens[length];
      if (next) group.next.add(brandKey(next));
      groups.set(key, group);
    }
  }

  /** Single tokens that start at least two titles — brands worth looking up. */
  const knownBrands = new Set(
    [...groups]
      .filter(([, group]) => group.titles >= 2)
      .map(([key]) => key)
  );

  // Most common original casing per brand key, so display follows the corpus
  // ("AVATTO" stays shouty, "Athom" stays capitalized).
  const casings = new Map<string, Map<string, number>>();
  const remember = (key: string, display: string) => {
    const counts = casings.get(key) ?? new Map<string, number>();
    counts.set(display, (counts.get(display) ?? 0) + 1);
    casings.set(key, counts);
  };

  const brandOf = new Map<string, string>();

  /**
   * Grow a brand from `start` while there is corroborating evidence: more
   * than one device under this prefix, all continuing with the same token.
   */
  const extend = (tokens: string[], start: number): string => {
    let length = 1;
    while (length < Math.min(MAX_BRAND_TOKENS, tokens.length - start)) {
      const group = groups.get(
        brandKey(tokens.slice(start, start + length).join(" "))
      );
      if (!group || group.titles < 2 || group.next.size !== 1) break;
      length++;
    }
    return tokens.slice(start, start + length).join(" ");
  };

  for (const title of titles) {
    const tokens = titleTokens(title);
    if (tokens.length === 0) continue;

    let display: string | null = null;
    if (!isBrandlessToken(tokens[0])) {
      display = extend(tokens, 0);
    } else {
      // Opened with a spec or generic word: take the first token further
      // along that other titles use as a brand.
      const index = tokens.findIndex((token) => knownBrands.has(brandKey(token)));
      if (index > 0) display = extend(tokens, index);
    }
    if (!display) continue;

    const key = brandKey(display);
    remember(key, display);
    brandOf.set(title, key);
  }

  // Second pass: swap the grouping key for the winning display spelling.
  const result = new Map<string, string>();
  for (const [title, key] of brandOf) {
    const counts = casings.get(key);
    let best = key;
    let bestCount = -1;
    for (const [display, count] of counts ?? []) {
      // Ties break on the alphabetically first spelling for a stable build.
      if (count > bestCount || (count === bestCount && display < best)) {
        best = display;
        bestCount = count;
      }
    }
    result.set(title, best);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Capabilities and components, read out of the page's yaml
// ---------------------------------------------------------------------------

/**
 * What a device can do, in the words a person searching would use. Keys are
 * matched against the union of top-level yaml keys and `platform:` values on
 * the page, so both `sensor: [{platform: hlw8012}]` and a bare `tuya:` block
 * classify correctly.
 *
 * Order is display order.
 */
export const CAPABILITY_BUCKETS: readonly {
  id: string;
  label: string;
  components: readonly string[];
}[] = [
  {
    id: "power-monitoring",
    label: "Power monitoring",
    components: [
      "ade7880", "ade7953", "ade7953_i2c", "ade7953_spi", "atm90e26",
      "atm90e32", "bl0906", "bl0910", "bl0937", "bl0939", "bl0940", "bl0942",
      "cse7761", "cse7766", "cs5460a", "ct_clamp", "hlw8012", "ina219",
      "ina226", "ina260", "ina2xx_i2c", "pzem004t", "pzemac", "pzemdc",
      "total_daily_energy",
    ],
  },
  {
    id: "relay",
    label: "Relay / switching",
    components: ["relay", "switch"],
  },
  {
    id: "light",
    label: "Light / dimming",
    components: [
      "light", "bp1658cj", "bp5758d", "cwww", "esp8266_pwm", "ledc",
      "libretiny_pwm", "monochromatic", "my9231", "pca9685", "rgb", "rgbct",
      "rgbw", "rgbww", "sm16716", "sm2135", "sm2235", "sm2335", "mcp4728",
    ],
  },
  {
    id: "addressable-light",
    label: "Addressable LED strip",
    components: [
      "beken_spi_led_strip", "esp32_rmt_led_strip", "fastled_clockless",
      "neopixelbus", "rp2040_pio_led_strip", "spi_led_strip",
    ],
  },
  {
    id: "temperature",
    label: "Temperature / humidity",
    components: [
      "aht10", "am2320", "bme280", "bme280_i2c", "bme680", "bmp085", "bmp280",
      "dallas", "dallas_temp", "dht", "dht12", "hdc1080", "htu21d",
      "internal_temperature", "ntc", "one_wire", "scd30", "scd4x", "sht3xd",
      "sht4x", "shtcx", "si7021", "tmp102", "dallas_temp_ms",
    ],
  },
  {
    id: "air-quality",
    label: "Air quality / gas",
    components: [
      "bme68x_bsec2", "ccs811", "ens160", "ens160_i2c", "mhz19", "mics_4514",
      "pmsx003", "senseair", "sen5x", "sgp30", "sgp4x", "sps30", "t6615",
      "hm3301", "co2", "aht20",
    ],
  },
  {
    id: "presence",
    label: "Presence / motion",
    components: [
      "ld2410", "ld2410s", "ld2420", "ld2450", "ltr390", "pir", "seeed_mr24hpc1",
      "hlk_ld2410", "dfrobot_sen0395", "mmwave",
    ],
  },
  {
    id: "display",
    label: "Display",
    components: [
      "display", "font", "graph", "ili9xxx", "lvgl", "max7219digit", "mipi_spi",
      "nextion", "pcd8544", "sh1106_i2c", "ssd1306_i2c", "ssd1306_spi",
      "ssd1327_i2c", "st7789v", "st7920", "tm1621", "tm1637", "waveshare_epaper",
      "image", "qspi_dbi",
    ],
  },
  {
    id: "touchscreen",
    label: "Touchscreen",
    components: ["touchscreen", "cst816", "ft63x6", "gt911", "xpt2046", "ektf2232"],
  },
  {
    id: "ir-rf",
    label: "IR / RF remote",
    components: ["remote_receiver", "remote_transmitter"],
  },
  {
    id: "bluetooth",
    label: "Bluetooth",
    components: [
      "ble", "ble_client", "bluetooth_proxy", "esp32_ble", "esp32_ble_server",
      "esp32_ble_tracker", "esp32_improv",
    ],
  },
  {
    id: "audio",
    label: "Audio / voice",
    components: [
      "i2s_audio", "media_player", "microphone", "micro_wake_word", "speaker",
      "voice_assistant", "mixer", "resampler",
    ],
  },
  {
    id: "cover",
    label: "Cover / garage",
    components: [
      "cover", "current_based", "endstop", "feedback", "ratgdo", "secplus_gdo",
      "time_based", "iq2020",
    ],
  },
  {
    id: "fan",
    label: "Fan",
    components: ["fan", "speed"],
  },
  {
    id: "climate",
    label: "Climate / thermostat",
    components: [
      "climate", "bang_bang", "heatpumpir", "midea_ac", "pid", "thermostat",
      "tuya_climate", "whirlpool_ac",
    ],
  },
  {
    id: "energy-meter",
    label: "Multi-channel energy meter",
    components: ["atm90e32", "ade7880", "bl0910", "bl0906", "modbus_controller"],
  },
  {
    id: "tuya-mcu",
    label: "Tuya MCU (serial)",
    components: ["tuya", "tuyanew", "tuya_light", "tuya_switch", "dxs238xw"],
  },
  {
    id: "modbus",
    label: "Modbus",
    components: ["modbus", "modbus_controller"],
  },
  {
    id: "ethernet",
    label: "Wired ethernet",
    components: ["ethernet", "ethernet_info"],
  },
  {
    id: "expander",
    label: "GPIO expander / ADC",
    components: [
      "ads1115", "ads1220", "cd74hc4067", "mcp23008", "mcp23016", "mcp23017",
      "mcp23s08", "mcp23s17", "pcf8574", "sn74hc165", "sn74hc595", "sx1509",
      "ads1115_i2c",
    ],
  },
  {
    id: "external-components",
    label: "Needs external components",
    components: ["external_components"],
  },
];

const CAPABILITY_BY_COMPONENT = new Map<string, string[]>();
for (const bucket of CAPABILITY_BUCKETS) {
  for (const component of bucket.components) {
    const list = CAPABILITY_BY_COMPONENT.get(component) ?? [];
    list.push(bucket.id);
    CAPABILITY_BY_COMPONENT.set(component, list);
  }
}

/**
 * Components too generic to say anything about a device: every page has wifi
 * and a logger, and `platform: gpio` appears 4633 times across the corpus.
 */
const IGNORED_COMPONENTS = new Set([
  "api", "binary", "captive_portal", "copy", "dashboard_import", "debug",
  "esphome", "factory_reset", "globals", "gpio", "homeassistant", "improv_serial",
  "interval", "logger", "mdns", "mqtt", "ota", "packages", "preferences",
  "restart", "safe_mode", "script", "shutdown", "sntp", "status", "status_led",
  "substitutions", "template", "time", "uptime", "version", "web_server",
  "web_server_idf", "wifi", "wifi_info", "wifi_signal", "esp32", "esp8266",
  "bk72xx", "rtl87xx", "ln882x", "rp2040", "libretiny", "psram", "select",
  "number", "button", "output", "sensor", "text_sensor", "binary_sensor",
  "switch", "light", "esp32_improv", "update", "http_request", "json", "sun",
]);

/** Extract top-level keys and `platform:` values from fenced yaml. */
export function extractComponents(yamlText: string): string[] {
  const found = new Set<string>();
  for (const line of yamlText.split("\n")) {
    const topLevel = /^([a-z_][a-z0-9_]*):/.exec(line);
    if (topLevel) found.add(topLevel[1]);
    const platform = /^\s*-?\s*platform:\s*["']?([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (platform) found.add(platform[1].toLowerCase());
  }
  return [...found].filter((name) => !IGNORED_COMPONENTS.has(name)).sort();
}

export function extractCapabilities(components: readonly string[]): string[] {
  const found = new Set<string>();
  for (const component of components) {
    for (const id of CAPABILITY_BY_COMPONENT.get(component) ?? []) {
      found.add(id);
    }
  }
  // Ordered by CAPABILITY_BUCKETS so the UI never has to sort.
  return CAPABILITY_BUCKETS.filter((bucket) => found.has(bucket.id)).map(
    (bucket) => bucket.id
  );
}

/** ESPHome framework, from `type: esp-idf` / `type: arduino` under esp32/esp8266. */
export function extractFramework(yamlText: string): string[] {
  const found = new Set<string>();
  if (/^\s+type:\s*esp-idf\b/m.test(yamlText)) found.add("esp-idf");
  if (/^\s+type:\s*arduino\b/m.test(yamlText)) found.add("arduino");
  return [...found];
}

// ---------------------------------------------------------------------------
// Install method, from prose
// ---------------------------------------------------------------------------

/**
 * How you get ESPHome onto the device. Phrases are matched case-insensitively
 * against the page's prose (yaml stripped, so a `# soldering` comment in a
 * config does not count).
 *
 * Order is display order.
 */
export const INSTALL_METHODS: readonly {
  id: string;
  label: string;
  patterns: readonly RegExp[];
}[] = [
  {
    id: "preflashed",
    label: "Ships with ESPHome",
    patterns: [
      /\bpre-?flashed with esphome\b/i,
      /\bcomes with esphome\b/i,
      /\bships with esphome\b/i,
      /\bpre-?installed esphome\b/i,
    ],
  },
  {
    id: "ota",
    label: "OTA (no disassembly)",
    patterns: [
      /\btuya-?convert\b/i,
      /\bcloudcutter\b/i,
      /\bover[- ]the[- ]air\b/i,
      /\bno (?:disassembly|soldering|teardown)\b/i,
      /\bwithout (?:opening|disassembl|solder)/i,
    ],
  },
  {
    id: "tuya-convert",
    label: "tuya-convert",
    patterns: [/\btuya-?convert\b/i],
  },
  {
    id: "cloudcutter",
    label: "Cloudcutter",
    patterns: [/\bcloudcutter\b/i],
  },
  {
    id: "libretiny",
    label: "LibreTiny / ltchiptool",
    patterns: [/\blibre-?tiny\b/i, /\bltchiptool\b/i, /\bbk7231\b/i],
  },
  {
    id: "from-tasmota",
    label: "Migrate from Tasmota",
    patterns: [/\bfrom tasmota\b/i, /\btasmota\b.{0,40}\besphome\b/i],
  },
  {
    id: "serial",
    label: "Serial / UART flashing",
    patterns: [
      /\b(?:serial|uart|ftdi|usb-?ttl|ttl adapter)\b.{0,60}\bflash/i,
      /\bflash.{0,60}\b(?:serial|uart|ftdi|usb-?ttl)\b/i,
      /\bprogramming header\b/i,
      /\besptool\b/i,
    ],
  },
  {
    id: "soldering",
    label: "Soldering required",
    patterns: [/\bsolder(?:ing|ed)?\b/i],
  },
];

/** Strip fenced code blocks so prose matching does not read yaml comments. */
export function stripCodeBlocks(markdown: string): string {
  return markdown.replace(/```[\s\S]*?(?:```|$)/g, " ");
}

export function extractInstallMethods(prose: string): string[] {
  return INSTALL_METHODS.filter((method) =>
    method.patterns.some((pattern) => pattern.test(prose))
  ).map((method) => method.id);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const CAPABILITY_LABELS = new Map(
  CAPABILITY_BUCKETS.map((bucket) => [bucket.id, bucket.label])
);
const INSTALL_LABELS = new Map(
  INSTALL_METHODS.map((method) => [method.id, method.label])
);

const FRAMEWORK_LABELS: Record<string, string> = {
  arduino: "Arduino",
  "esp-idf": "ESP-IDF",
};

const FLAG_LABELS: Record<string, string> = {
  "made-for-esphome": "Made for ESPHome",
  "has-config": "Has YAML config",
  "has-image": "Has a photo",
  "open-hardware": "Open hardware / DIY",
};

/** Human label for a facet value, used by both the server and the client. */
export function facetValueLabel(facet: string, value: string): string {
  switch (facet) {
    case "type":
      return TYPE_LABELS[value] ?? value;
    case "board":
      return BOARD_LABELS[value] ?? value.toUpperCase();
    case "standard":
      return STANDARD_LABELS[value] ?? value.toUpperCase();
    case "difficulty": {
      const level = Number(value);
      return DIFFICULTY_LABELS[level]
        ? `${level} — ${DIFFICULTY_LABELS[level]}`
        : value;
    }
    case "capability":
      return CAPABILITY_LABELS.get(value) ?? value;
    case "install":
      return INSTALL_LABELS.get(value) ?? value;
    case "framework":
      return FRAMEWORK_LABELS[value] ?? value;
    case "flag":
      return FLAG_LABELS[value] ?? value;
    default:
      return value;
  }
}

/**
 * Facets in sidebar order. `linkBase` marks the three that have their own
 * listing pages, so the browser can offer a permalink to /type/plug and
 * friends; `searchable` turns on the filter box for long value lists.
 */
export const FACET_DEFINITIONS: readonly {
  id: string;
  label: string;
  linkBase?: string;
  searchable?: boolean;
  collapsed?: boolean;
}[] = [
  { id: "type", label: "Device type", linkBase: "type" },
  { id: "capability", label: "Capabilities" },
  { id: "board", label: "Microcontroller", linkBase: "board" },
  { id: "standard", label: "Electrical standard", linkBase: "standards" },
  { id: "difficulty", label: "Flashing difficulty" },
  { id: "install", label: "Install method", collapsed: true },
  { id: "brand", label: "Brand", searchable: true, collapsed: true },
  { id: "component", label: "ESPHome component", searchable: true, collapsed: true },
  { id: "framework", label: "Framework", collapsed: true },
  { id: "flag", label: "Other", collapsed: true },
];

export type DeviceFacetValues = Record<string, string[]>;

/**
 * Build the facet values for one device.
 *
 * `brand` comes from deriveBrands() over every title, so it is passed in
 * rather than computed here.
 */
export function buildFacetValues(options: {
  data: RawDeviceMetadata;
  brand: string | null;
  yamlText: string;
  prose: string;
  hasImage: boolean;
}): DeviceFacetValues {
  const { data, brand, yamlText, prose, hasImage } = options;

  const type = normalizeType(data.type);
  const difficulty = normalizeDifficulty(readField(data, "difficulty"));
  const components = extractComponents(yamlText);
  const madeForEsphome = isMadeForEsphome(readField(data, "made-for-esphome"));
  const hasConfig = yamlText.trim().length > 0;

  const flags: string[] = [];
  if (madeForEsphome) flags.push("made-for-esphome");
  if (hasConfig) flags.push("has-config");
  if (hasImage) flags.push("has-image");
  if (data["project-url"]) flags.push("open-hardware");

  return {
    type: type ? [type] : [],
    brand: brand ? [brand] : [],
    board: normalizeBoards(readField(data, "board")),
    standard: normalizeStandards(data.standard),
    capability: extractCapabilities(components),
    component: components,
    install: extractInstallMethods(prose),
    difficulty: difficulty ? [String(difficulty)] : [],
    framework: extractFramework(yamlText),
    flag: flags,
  };
}
