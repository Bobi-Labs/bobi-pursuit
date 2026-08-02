/**
 * Package the extension for both stores.
 *
 *   node extension/build.mjs
 *
 * Produces, in extension/dist/:
 *   bobi-pursuit-capture-chrome-<version>.zip   -> Chrome Web Store
 *   bobi-pursuit-capture-firefox-<version>.zip  -> Firefox AMO
 *
 * The two builds share every source file and differ ONLY in the manifest,
 * because the panel APIs are not the same: Chrome has `side_panel` and an MV3
 * service worker, Firefox has `sidebar_action` and an MV3 event page. The
 * Firefox zip gets `manifest.firefox.json` renamed to `manifest.json`, and
 * `manifest.firefox.json` itself is never shipped inside either archive.
 *
 * Uses the system `zip` if present, else PowerShell's Compress-Archive, so this
 * works on a bare Windows box with no extra tooling.
 */
import {
  cpSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "fs";
import { deflateRawSync } from "zlib";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "dist");
const STAGE = resolve(DIST, ".stage");

/** Everything a store build needs. Anything not listed here does not ship. */
const SHIPPED = [
  "background.js",
  "sidepanel.html",
  "sidepanel.js",
  "options.html",
  "options.js",
  "icons",
];

const version = JSON.parse(
  readFileSync(resolve(HERE, "manifest.json"), "utf8"),
).version;

/* ── A minimal, spec-correct ZIP writer ───────────────────────────────────
 *
 * Written by hand rather than shelling out, because the obvious shortcuts are
 * both wrong on Windows: PowerShell's Compress-Archive (and .NET's
 * ZipFile.CreateFromDirectory on the Framework) writes entry names with
 * BACKSLASH separators. The ZIP spec requires forward slashes, and both the
 * Chrome Web Store and AMO have historically rejected or flattened such
 * archives. That failure arrives days later as an opaque rejection, which is
 * an expensive way to learn it. There is no POSIX `zip` here and Git Bash
 * ships GNU tar, which has no usable zip mode, so Node writes the bytes.
 *
 * Deterministic on purpose: a fixed DOS timestamp means an unchanged source
 * tree produces a byte-identical archive, so a resubmission diff is real.
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 2026-01-01 00:00:00 in DOS date/time, so builds are reproducible. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zipEntries(entries, outFile) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8"); // already forward-slashed
    const deflated = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(deflated.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, deflated);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 30); // extra + comment lengths
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + deflated.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  writeFileSync(outFile, Buffer.concat([...locals, cdBuf, eocd]));
}

/** Walk a directory into flat {name, data} entries with forward-slash names. */
function collect(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const abs = resolve(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...collect(abs, rel));
    else out.push({ name: rel, data: readFileSync(abs) });
  }
  return out;
}

function zipDir(srcDir, outFile) {
  zipEntries(collect(srcDir), outFile);
  return "node";
}

function build(target, manifestSource) {
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });

  for (const item of SHIPPED) {
    const from = resolve(HERE, item);
    if (!existsSync(from)) throw new Error(`missing shipped file: ${item}`);
    cpSync(from, resolve(STAGE, item), { recursive: true });
  }

  // The manifest is the only per-target difference. Copy it in under the one
  // name both browsers look for.
  cpSync(resolve(HERE, manifestSource), resolve(STAGE, "manifest.json"));

  const out = resolve(DIST, `bobi-pursuit-capture-${target}-${version}.zip`);
  rmSync(out, { force: true });
  const via = zipDir(STAGE, out);
  rmSync(STAGE, { recursive: true, force: true });
  return { out, via };
}

mkdirSync(DIST, { recursive: true });
const chrome = build("chrome", "manifest.json");
const firefox = build("firefox", "manifest.firefox.json");

console.log(`Bobi-Pursuit — Capture v${version}`);
console.log(`  chrome  -> ${chrome.out}  (${chrome.via})`);
console.log(`  firefox -> ${firefox.out}  (${firefox.via})`);
console.log("\nUpload the chrome zip to the Chrome Web Store developer dashboard,");
console.log("and the firefox zip to addons.mozilla.org. Listing copy and the");
console.log("permission justifications are in extension/STORE.md.");
