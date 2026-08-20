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

/* ── The extension handoff, parked ──────────────────────────────────────────
 *
 * "Save this search" arrives as a query param on `/`, and the app has to move
 * to the Searches tab to show it. That move is a route change, and this was
 * carried across it twice the wrong way first — in component state, which the
 * remount destroys, and then in a module-level session object, which does not
 * survive if the navigation is a document load rather than a soft push.
 *
 * Both failed silently and identically: the right tab, an empty form, no error
 * anywhere. So it is parked in storage, which survives either kind of
 * navigation and does not require knowing which one happened. Read once on the
 * far side, then cleared — it is a message in transit, not a preference.
 */

const PENDING_KEY = "pursuit.pendingSearch";

export interface PendingSearch {
  url: string;
  label: string;
  site: string;
}

export function parkPendingSearch(pending: PendingSearch): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Nothing to do; the user can still paste the URL by hand.
  }
}

/**
 * Reads WITHOUT clearing, and that separation is the fix rather than a style
 * choice.
 *
 * This was read-and-clear, which is the obvious shape for a one-shot handoff
 * and was wrong here for a reason worth writing down: `goTab` sets the tab
 * optimistically so the click feels instant, and only then does the router
 * commit the route. So the Searches panel mounts TWICE — once on the outgoing
 * shell, once on the one the navigation produces. A token that deletes itself
 * on read is consumed by the first mount and gone by the second, which is
 * exactly what the user sees.
 *
 * Clearing is now `clearPendingSearch`, called when the search is actually
 * saved. A refresh before saving re-fills the form, which is the right
 * behaviour anyway: you have not dealt with it yet.
 */
export function peekPendingSearch(): PendingSearch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as PendingSearch).url === "string" &&
      isSafeUrl((parsed as PendingSearch).url)
    ) {
      return parsed as PendingSearch;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPendingSearch(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do.
  }
}
