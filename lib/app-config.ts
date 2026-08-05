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
