/**
 * Capture — turning a page you are looking at into a job in the pipeline.
 *
 * There are two capture routes, and they both speak the SAME query-string
 * dialect, because they were built against the hosted app first:
 *
 *   ?add=1&t=<title>&u=<url>&d=<description>&b=<budget hint>&s=<source>
 *
 *   - the Chrome extension sends  add,t,u,d,s
 *   - the bookmarklet sends       add,t,u,d,s  (+ b when the site exposes one)
 *
 * Do not rename these params. Extensions live in people's browsers for
 * months after a release; a rename silently breaks every installed copy.
 *
 * Everything here is pure and safe under `output: 'export'` prerendering —
 * no `window`, `document` or `localStorage` at module scope or call time.
 * The caller passes the search string in (`window.location.search`), which
 * keeps the browser-only bit at the call site, inside an effect.
 */

export interface CaptureParams {
  title: string;
  url: string;
  description: string;
  company: string;
  budgetHint: string;
  source: string;
}

/** Per-field clamps. Generous enough for a real job description, small
 *  enough that a hostile or malformed URL can't wedge the UI. */
const LIMIT = {
  title: 300,
  url: 800,
  description: 12_000,
  budgetHint: 200,
  source: 80,
} as const;

// Control characters are stripped before storage: a stray NUL or vertical
// tab from a badly-encoded page breaks JSON round-tripping and renders as
// tofu. Tab (9), newline (10) and carriage return (13) are KEPT -- a job
// description without its paragraph breaks is unreadable, and reading it
// later is the entire point of capturing it.
function isControlChar(code: number): boolean {
  if (code === 9 || code === 10 || code === 13) return false;
  return code < 32 || code === 127;
}

/** Strip control characters, trim, and clamp to `max` characters. */
function clip(value: string | null, max: number): string {
  if (!value) return "";
  let out = "";
  for (const ch of value) {
    if (!isControlChar(ch.charCodeAt(0))) out += ch;
  }
  return out.trim().slice(0, max);
}

/**
 * Parse a capture handoff out of a location search string.
 *
 * Returns `null` unless `add=1` — so it is safe to call on every page
 * load and branch on the result.
 *
 * @param search `window.location.search`, with or without the leading "?".
 */
export function parseCaptureParams(search: string): CaptureParams | null {
  if (!search) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }

  if (params.get("add") !== "1") return null;

  const url = clip(params.get("u"), LIMIT.url);

  // Source precedence: what the capturer told us > the host we can derive
  // from the URL > a neutral default. The extension always sets `s`; a
  // hand-written bookmarklet might not.
  const source = clip(params.get("s"), LIMIT.source) || hostFromUrl(url) || "manual";

  return {
    title: clip(params.get("t"), LIMIT.title),
    url,
    description: clip(params.get("d"), LIMIT.description),
    // No capture route sends a company today — the field exists so the
    // add-job form has somewhere to put one when a site starts exposing it.
    company: clip(params.get("c"), LIMIT.title),
    budgetHint: clip(params.get("b"), LIMIT.budgetHint),
    source,
  };
}

/**
 * Query params that identify a *campaign*, never a *job*. Stripped before
 * dedupe so the same posting arriving from a newsletter, a search page and
 * a direct visit collapses to one entry.
 *
 * Deliberately conservative: params that identify the posting itself
 * (`gh_jid`, `jk`, `currentJobId`, `lever-origin`, …) are NOT in here, and
 * must never be — dropping one would merge two different jobs into one.
 */
const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "dclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "ref",
  "ref_src",
  "refid",
  "referrer",
  "trk",
  "trackingid",
  "trk_info",
  "src",
  "source",
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

/**
 * Does this look like a real hostname?
 *
 * Needed because the URL parser is far more permissive than DNS: it happily
 * accepts `https://!!!` and reports a hostname of "!!!". Without this check,
 * junk pasted into the URL field would come back out as a source label.
 * Requires a dotted name, or `localhost`, or an IPv6 literal.
 */
function isPlausibleHost(host: string): boolean {
  if (!host) return false;
  if (host === "localhost") return true;
  if (host.startsWith("[") && host.endsWith("]")) return true; // IPv6
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host);
}

/**
 * Parse to an http(s) URL with a believable host, or null.
 *
 * Two attempts: as given, then with a scheme bolted on, so a bare
 * "example.com/jobs/1" (which people do paste) still resolves.
 */
function parseHttpUrl(raw: string): URL | null {
  const attempt = (candidate: string): URL | null => {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!isPlausibleHost(parsed.hostname.toLowerCase())) return null;
    return parsed;
  };
  return attempt(raw) ?? attempt(`https://${raw}`);
}

/**
 * Canonical **dedupe key** for a job URL — not a navigable URL.
 *
 * Scheme, `www.`, the fragment, tracking params and a trailing slash all
 * come off; remaining params are sorted so param order doesn't create a
 * false "new job". Unparseable input is returned lowercased and trimmed so
 * a garbage URL still dedupes against itself rather than against nothing.
 *
 * Use it for comparison and storage keys. Never render it as a link.
 */
export function normalizeUrl(url: string): string {
  const raw = (url || "").trim();
  if (!raw) return "";

  const parsed = parseHttpUrl(raw);
  if (!parsed) return raw.toLowerCase();

  const host = parsed.host.toLowerCase().replace(/^www\./, "");

  const kept: [string, string][] = [];
  parsed.searchParams.forEach((value, key) => {
    if (!isTrackingParam(key)) kept.push([key, value]);
  });
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = kept.length
    ? `?${kept.map(([k, v]) => `${k}=${v}`).join("&")}`
    : "";

  const path = parsed.pathname.replace(/\/+$/, "");

  return `${host}${path}${query}`;
}

/**
 * Hostname of a URL, lowercased and stripped of `www.` — used as a source
 * label when the capturer didn't send one. Returns "" if unparseable, so
 * callers can `|| fallback` safely.
 */
export function hostFromUrl(url: string): string {
  const raw = (url || "").trim();
  if (!raw) return "";
  const parsed = parseHttpUrl(raw);
  if (!parsed) return "";
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}
