"use client";

/**
 * One searchable, filterable list of links — rendered twice, as Job Sites and
 * as Resources.
 *
 * Both tabs are the same shape: a name, a one-line blurb, honest strengths and
 * weaknesses, one badge, and a link out. Writing it once means a third list
 * later costs a data file and a route, not a component.
 *
 * Three decisions worth knowing:
 *
 *  - **Nothing is fetched.** These are anchors. The product does not scrape and
 *    cannot, so a directory is the honest way to help someone find postings:
 *    it points, they go, they capture what they find with the extension.
 *  - **Search covers the weaknesses too.** Typing "ghost jobs" or "bankruptcy"
 *    finds the entries that admit to them, which is the fastest way to use a
 *    list like this and impossible if the text were marketing copy.
 *  - **Favourites live in `localStorage` under their own key, not in the
 *    pipeline document.** They are a preference about the app, not part of your
 *    job data: they must not ride along in an export, must not participate in
 *    the schema version, and must not be lost when you clear the board.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  addSearch,
  isSafeUrl,
  readSearches,
  removeSearch,
  type SavedSearch,
} from "@/lib/saved-searches";
import { Button, Chip, INPUT, PanelHeader, cx } from "./ui";

export interface DirectoryEntry {
  name: string;
  url: string;
  category: string;
  blurb: string;
  strengths: string[];
  weaknesses: string[];
  /** Rendered as the badge on the right of the row. */
  badge: string;
  /** Drives the badge colour. */
  badgeTone: "green" | "blue" | "muted" | "amber";
}

const BADGE_TONE: Record<DirectoryEntry["badgeTone"], string> = {
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  blue: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  muted: "border-border bg-card text-muted-foreground",
};

/**
 * Read once on mount, never during render.
 *
 * The app is a static export, so this component runs in Node at build time
 * where there is no `localStorage`. Reading it during render would bake one
 * user's favourites into `out/index.html` — or, more likely, throw.
 */
function useFavourites(storageKey: string) {
  const [favourites, setFavourites] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setFavourites(parsed.filter((v): v is string => typeof v === "string"));
      }
    } catch {
      // A corrupt or unavailable store costs a preference, not the page.
    }
  }, [storageKey]);

  const toggle = (name: string) => {
    setFavourites((prev) => {
      const next = prev.includes(name)
        ? prev.filter((n) => n !== name)
        : [...prev, name];
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Private mode. The toggle still works for this session.
      }
      return next;
    });
  };

  return { favourites, toggle };
}

export function Directory({
  title,
  sub,
  entries,
  categories,
  categoryLabel,
  storageKey,
  searchPlaceholder,
  savedSearches,
}: {
  title: string;
  sub: string;
  entries: DirectoryEntry[];
  categories: string[];
  categoryLabel: Record<string, string>;
  /** Its own localStorage key — see the note on favourites above. */
  storageKey: string;
  searchPlaceholder: string;
  /** Job Sites only. Resources has nothing to search on somebody else's site. */
  savedSearches?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (savedSearches) setSearches(readSearches());
  }, [savedSearches]);
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const { favourites, toggle } = useFavourites(storageKey);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (onlyFavourites && !favourites.includes(entry.name)) return false;
      if (category !== "all" && entry.category !== category) return false;
      if (!q) return true;
      // Strengths and weaknesses are searched deliberately: "ghost jobs" and
      // "RSS" are how someone actually looks for what they want here.
      const hay = [
        entry.name,
        entry.blurb,
        entry.category,
        entry.badge,
        ...entry.strengths,
        ...entry.weaknesses,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, category, onlyFavourites, favourites]);

  // Favourites first, then alphabetical, so a starred site stops being a
  // needle in the list the moment you star it.
  const ordered = useMemo(() => {
    const starred = (e: DirectoryEntry) => (favourites.includes(e.name) ? 0 : 1);
    return [...shown].sort(
      (a, b) => starred(a) - starred(b) || a.name.localeCompare(b.name),
    );
  }, [shown, favourites]);

  return (
    <div>
      <PanelHeader title={title} sub={sub} />

      {savedSearches ? (
        <SavedSearches
          searches={searches}
          onRemove={(id) => setSearches(removeSearch(id))}
        />
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className={cx(INPUT, "w-full sm:w-72")}
        />

        <span className="hidden h-4 w-px bg-border sm:block" />

        <Chip on={category === "all"} onClick={() => setCategory("all")}>
          All
        </Chip>
        {categories.map((key) => (
          <Chip
            key={key}
            on={category === key}
            onClick={() => setCategory(category === key ? "all" : key)}
          >
            {categoryLabel[key] ?? key}
          </Chip>
        ))}

        <span className="hidden h-4 w-px bg-border sm:block" />

        <Chip
          on={onlyFavourites}
          onClick={() => setOnlyFavourites((v) => !v)}
          title="Show only the ones you starred"
        >
          ★ Starred{favourites.length > 0 ? ` ${favourites.length}` : ""}
        </Chip>
      </div>

      <div className="mb-3 text-[12px] text-text-muted">
        {ordered.length} of {entries.length} · nothing here is fetched or
        scraped — these are links, and the extension captures what you find.
      </div>

      {ordered.length === 0 ? (
        <div className="py-16 text-center text-[14px] text-muted-foreground">
          Nothing matches. Clear the search, or try a category.
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {ordered.map((entry) => (
            <Row
              key={entry.name}
              entry={entry}
              starred={favourites.includes(entry.name)}
              onStar={() => toggle(entry.name)}
              categoryLabel={categoryLabel}
              adding={adding === entry.name}
              onAdd={savedSearches ? () => setAdding(entry.name) : undefined}
              onCancelAdd={() => setAdding(null)}
              onSaveSearch={(label, url) => {
                setSearches(addSearch({ label, url, site: entry.name }));
                setAdding(null);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  entry,
  starred,
  onStar,
  categoryLabel,
  adding,
  onAdd,
  onCancelAdd,
  onSaveSearch,
}: {
  entry: DirectoryEntry;
  starred: boolean;
  onStar: () => void;
  categoryLabel: Record<string, string>;
  adding?: boolean;
  onAdd?: () => void;
  onCancelAdd?: () => void;
  onSaveSearch?: (label: string, url: string) => void;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[14px] font-bold text-foreground transition-colors hover:text-primary"
          >
            {entry.name} ↗
          </a>
          <div className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
            {entry.blurb}
          </div>
        </div>
        <button
          type="button"
          onClick={onStar}
          aria-pressed={starred}
          title={starred ? "Remove from starred" : "Star this"}
          className={cx(
            "shrink-0 rounded-md border px-2 py-1 text-[13px] transition-colors",
            starred
              ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {starred ? "★" : "☆"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-border bg-elevated px-1.5 py-0.5 text-[12px] text-muted-foreground">
          {categoryLabel[entry.category] ?? entry.category}
        </span>
        <span
          className={cx(
            "rounded-full border px-1.5 py-0.5 text-[12px] font-semibold",
            BADGE_TONE[entry.badgeTone],
          )}
        >
          {entry.badge}
        </span>
      </div>

      <Points tone="good" items={entry.strengths} />
      <Points tone="bad" items={entry.weaknesses} />

      {onAdd && !adding ? (
        <button
          type="button"
          onClick={onAdd}
          className="mt-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-primary"
        >
          + Save a search here
        </button>
      ) : null}

      {adding && onSaveSearch ? (
        <SaveSearchForm
          site={entry.name}
          onCancel={onCancelAdd ?? (() => {})}
          onSave={onSaveSearch}
        />
      ) : null}
    </div>
  );
}

/**
 * Paste the URL of a search you have already tuned on that site.
 *
 * Deliberately a paste rather than a form that builds the query. Every board
 * has its own parameters and changes them without warning; a builder would be
 * subtly wrong on half of them within a year, and wrong in a way the user
 * cannot see. Their own URL is always exactly right.
 */
function SaveSearchForm({
  site,
  onSave,
  onCancel,
}: {
  site: string;
  onSave: (label: string, url: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const valid = isSafeUrl(url);

  return (
    <div className="mt-2 rounded-lg border border-border bg-elevated p-2.5">
      <div className="mb-1.5 text-[13px] text-text-muted">
        Tune a search on {site}, then paste its address here.
      </div>
      <input
        className={cx(INPUT, "mb-1.5")}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name it — “Remote PM, £70k+”"
      />
      <input
        className={cx(INPUT, "mb-1.5 font-mono text-[12px]")}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
      />
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="primary"
          disabled={!valid}
          onClick={() => onSave(label, url)}
        >
          Save
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {url && !valid ? (
          <span className="text-[13px] text-amber-400">
            Needs to be a full http(s) address.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The saved list, above the directory because it is what you came back for.
 *
 * A returning user is not browsing seventy-six sites; they are re-running the
 * four searches they already tuned.
 */
function SavedSearches({
  searches,
  onRemove,
}: {
  searches: SavedSearch[];
  onRemove: (id: string) => void;
}) {
  /* Renders even when empty, which is the whole point.
   *
   * It used to return null until you had saved something, so the feature was
   * invisible to everyone who had not already found it — the operator asked
   * "where do I save those, and where do I see them?", which is the question a
   * hidden empty state guarantees. One line now says where the button is. */
  if (searches.length === 0) {
    return (
      <div className="mb-4 rounded-[10px] border border-dashed border-border bg-card/40 p-3">
        <div className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          Your searches
        </div>
        <div className="text-[14px] leading-snug text-text-muted">
          Tune a search on any site below — your filters, your salary floor —
          then use <span className="font-semibold text-foreground">+ Save a
          search here</span> on that site&apos;s card to keep it. They land back
          up here, one click to reopen.
        </div>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-[10px] border border-border bg-card p-3">
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
        Your searches
      </div>
      <div className="flex flex-wrap gap-1.5">
        {searches.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-elevated pl-2.5 text-[13px]"
          >
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              className="py-1.5 font-semibold text-foreground transition-colors hover:text-primary"
              title={s.url}
            >
              {s.label} ↗
            </a>
            <span className="text-[12px] text-text-muted">{s.site}</span>
            <button
              type="button"
              onClick={() => onRemove(s.id)}
              title="Remove this search"
              className="px-1.5 py-1.5 text-muted-foreground transition-colors hover:text-red-400"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 text-[13px] leading-snug text-text-muted">
        These are links you saved, reopened in one click. Nothing here runs a
        search or watches for new postings — the app has no server and cannot.
        Where a site offers email alerts, letting it tell you beats checking.
      </div>
    </div>
  );
}

/**
 * The honest half.
 *
 * Weaknesses render with the same weight as strengths rather than in smaller,
 * greyer text. A directory that visually buries its caveats is an advert with
 * extra steps.
 */
function Points({ tone, items }: { tone: "good" | "bad"; items: string[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {items.map((item) => (
        <li
          key={item}
          className="flex gap-1.5 text-[14px] leading-snug text-muted-foreground"
        >
          <span
            aria-hidden
            className={cx(
              "shrink-0 font-bold",
              tone === "good" ? "text-emerald-400" : "text-amber-400",
            )}
          >
            {tone === "good" ? "+" : "−"}
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}
