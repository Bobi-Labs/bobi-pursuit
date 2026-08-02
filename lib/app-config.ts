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
 * ⚠️ NULL ON PURPOSE, and the control does not render while it is null.
 *
 * The intake page for Pursuit does not exist yet. It is a ruled, dispatched job
 * on bobilabs-dev (2026-08-02): one relay serving several products, with a
 * `product` label carried end to end. That label matters here — the relay's
 * `FROM` is currently hardcoded to "Bobi Tracker Feedback", so the first Pursuit
 * report to land would arrive wearing the wrong product's name.
 *
 * Shipping a button that 404s is worse than shipping no button, so this stays
 * null until that page is live. Then it is one line, and the control appears.
 */
export const FEEDBACK_URL: string | null = null;

/** Public source. The extension lives under `extension/` in the same repo. */
export const REPO_URL = "https://github.com/Bobi-Labs/bobi-pursuit";
