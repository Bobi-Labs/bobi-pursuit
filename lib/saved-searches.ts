/**
 * Saved searches.
 *
 * What this is, precisely, because the phrase promises more than a local-first
 * app can deliver and the gap is where disappointment lives: **these are your
 * own search URLs, kept in one place and reopened in one click.** Nothing here
 * runs a search, polls a board, or notices a new posting. It cannot — the app
 * has no server, and a page in your browser cannot fetch a job board
 * cross-origin.
 *
 * That sounds like a consolation prize and is not, because of what a job hunt
 * actually looks like after two weeks: six tuned searches across four boards —
 * the Indeed one with the salary floor and the 25-mile radius, the LinkedIn one
 * filtered to the last 24 hours, the two Greenhouse boards — and no memory of
 * which is which. The tuning is the work. Losing it is the loss. A bookmark
 * folder does this badly; nothing else does it at all.
 *
 * The honest upgrade path is stated on the tab rather than hidden: many of
 * these sites will email you when a saved search matches, and `JobSite.alerts`
 * records which. Being told beats checking, and the app says so even though it
 * means pointing at somebody else's feature.
 *
 * Its own storage key, outside `pursuit.doc`, for the same reasons as
 * favourites: not job data, must not ride along in an export, must not touch
 * the schema version, must survive clearing the board.
 */

const KEY = "pursuit.searches";

export interface SavedSearch {
  id: string;
  /** What you call it. "Remote PM, £70k+" beats the URL every time. */
  label: string;
  url: string;
  /** The site it belongs to, when it was saved from a directory row. */
  site: string;
  addedAt: string;
}

function isSearch(value: unknown): value is SavedSearch {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    typeof v.url === "string"
  );
}

/** Browser-only — call from an effect. Static export has no localStorage at build time. */
export function readSearches(): SavedSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isSearch) : [];
  } catch {
    return [];
  }
}

function write(list: SavedSearch[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode. Works for the session.
  }
}

/**
 * Only http(s), and the check is not paranoia about this app.
 *
 * These strings are pasted by the user and then rendered into an `href`. A
 * `javascript:` URL in that position is a self-inflicted XSS the moment anyone
 * shares a saved-search list, which is exactly the kind of feature that grows
 * an export button six months later.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function addSearch(entry: Omit<SavedSearch, "id" | "addedAt">): SavedSearch[] {
  const list = readSearches();
  const next: SavedSearch = {
    ...entry,
    label: entry.label.trim() || entry.site || "Saved search",
    url: entry.url.trim(),
    id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    addedAt: new Date().toISOString(),
  };
  const updated = [...list, next];
  write(updated);
  return updated;
}

export function removeSearch(id: string): SavedSearch[] {
  const updated = readSearches().filter((s) => s.id !== id);
  write(updated);
  return updated;
}
