/**
 * Public identity and outward-facing links for the free tier.
 *
 * Everything a fork would want to change lives here, so retargeting this at
 * your own deployment is one file rather than a grep.
 */

export const APP_NAME = "Bobi-Pursuit";

/**
 * Where the "Feedback" control points.
 *
 * It is a LINK, not a POST, and that is forced rather than chosen: this app is
 * a static export with no server of its own, and its CSP is
 * `connect-src 'self' https://api.anthropic.com`, so the browser would refuse
 * to post anywhere else even if we wanted to. Intake therefore has to live on
 * a normal web page elsewhere, exactly as Bobi Tracker does it.
 *
 * The page belongs to bobilabs.dev, and reports arrive tagged
 * `[Bobi-Pursuit Bug]` / `[Bobi-Pursuit Idea]` from a per-product registry.
 * That registry exists because the relay previously hardcoded Bobi Tracker as
 * the sender, so the first Pursuit report would have arrived wearing another
 * product's name; the route now refuses an unknown product rather than
 * defaulting to one. Reports also persist to a table, so a report is a record
 * rather than only an email.
 *
 * The type stays `string | null` and the control stays conditional: a fork with
 * no intake of its own sets this to null and the button disappears rather than
 * pointing strangers at ours.
 */
export const FEEDBACK_URL: string | null =
  "https://bobilabs.dev/feedback/bobi-pursuit";

/** Public source. The extension lives under `extension/` in the same repo. */
export const REPO_URL = "https://github.com/Bobi-Labs/bobi-pursuit";

/* ── Where to install the capture extension ────────────────────────────────
 *
 * Both listings went public 2026-08-14. Before that the app told people to
 * download the `extension/` folder and side-load it through
 * `chrome://extensions` → Developer mode → Load unpacked, which was correct
 * while the extensions were unlisted and became actively wrong the moment they
 * were not: it walked a first-time user through a developer flow to reach
 * something that is now one click.
 *
 * The Chrome URL is the **id-only** form on purpose. The listing's canonical
 * address is `/detail/bobi-pursuit-—-capture/<id>`, whose slug carries a
 * literal em-dash; that has to be percent-encoded as %E2%80%94 to survive every
 * context it gets pasted into. `/detail/<id>` redirects to the canonical form
 * and is pure ASCII, so it is the one that cannot be mangled.
 *
 * Verified live rather than assumed, and the check needed care: the Chrome Web
 * Store answers **200 for a nonexistent id**, serving a shell that 404s on the
 * client, so the status code proves nothing. The discriminating probe is the
 * server-rendered og:title — the real id returns "Bobi-Pursuit — Capture", a
 * bogus one returns the generic "Chrome Web Store".
 */

/** Chrome Web Store listing. Id-only form; the store canonicalises it. */
export const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/imeiijihiifnfdancfojmelbnfpmfllb";

/** Firefox Add-ons listing. */
export const FIREFOX_EXTENSION_URL =
  "https://addons.mozilla.org/en-US/firefox/addon/bobi-pursuit-capture/";

/* ── Who made this ─────────────────────────────────────────────────────────
 *
 * A local-first app with no account and no server has no other way to say who
 * built it, and a stranger who likes the tool has nowhere to go. These are the
 * only outbound links in the product that are not about the user's own job
 * hunt, which is why they sit together and quietly, under the board rather
 * than over it.
 *
 * A fork should change or empty these. Each is checked before it renders, so
 * setting one to null removes it rather than shipping a dead control.
 */

/** Link tree — everything Bobi Labs does, including hiring us. */
export const STUDIO_LINKS_URL: string | null = "https://bobilabs.dev/links";

/** The studio's own site. */
export const STUDIO_URL: string | null = "https://bobilabs.dev";

/** Company page. */
export const STUDIO_LINKEDIN_URL: string | null =
  "https://www.linkedin.com/company/bobi-labs";
