/**
 * The end of a job hunt.
 *
 * Deliberately NOT a pipeline status, which was the operator's call and the
 * right one. A `hired` bucket would sit on the board forever holding exactly
 * one card, and every other column would keep implying there is more triaging
 * to do. Getting the job is not another column — it is the thing the board was
 * for, and the honest response is to congratulate you and offer to clear it.
 *
 * So this lives in its own `localStorage` key, outside `pursuit.doc`, for three
 * reasons that all point the same way:
 *
 *  - **It must survive clearing the board.** That is the entire flow: you got
 *    hired, you wipe the pipeline, and the banner is still there afterwards
 *    saying why it is empty. Inside the document it would be deleted by the
 *    very action it exists to explain.
 *  - **It must not ride along in an export.** A pipeline file you send someone,
 *    or import into another browser, should not carry "congratulations on your
 *    new role" from a different hunt.
 *  - **It must not touch the schema version.** No migration, no quarantine, no
 *    version bump for a banner.
 *
 * Same pattern as the directory favourites. Nothing here is job data.
 */

const HIRED_KEY = "pursuit.hired";

export interface HiredRecord {
  /** The role, as it was captured. */
  title: string;
  /** May be empty — plenty of postings never name the company. */
  company: string;
  /** ISO timestamp, so the banner can say when if it ever wants to. */
  at: string;
}

function isHired(value: unknown): value is HiredRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && typeof v.at === "string";
}

/**
 * Browser-only. Call from an effect, never during render — this app is a static
 * export and runs once in Node at build time, where there is no localStorage.
 */
export function readHired(): HiredRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HIRED_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isHired(parsed) ? parsed : null;
  } catch {
    // A corrupt or blocked store costs a banner, not the app.
    return null;
  }
}

export function writeHired(record: HiredRecord): void {
  try {
    window.localStorage.setItem(HIRED_KEY, JSON.stringify(record));
  } catch {
    // Private mode. The celebration lasts the session, which is enough.
  }
}

export function clearHired(): void {
  try {
    window.localStorage.removeItem(HIRED_KEY);
  } catch {
    // Nothing to do — see above.
  }
}
