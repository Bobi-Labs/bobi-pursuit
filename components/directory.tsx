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
 *  - **Saved searches are NOT here.** They were, briefly, as a strip and a
 *    per-row form — and then they got their own tab, because "where could I
 *    look" and "the four searches I run every morning" are different questions
 *    and the second is a returning user's homepage. Two routes to one feature
 *    is how a list grows duplicates nobody meant to make.
 *  - **Favourites live in `localStorage` under their own key, not in the
 *    pipeline document.** They are a preference about the app, not part of your
 *    job data: they must not ride along in an export, must not participate in
 *    the schema version, and must not be lost when you clear the board.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Chip, INPUT, PanelHeader, cx } from "./ui";

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
}: {
  title: string;
  sub: string;
  entries: DirectoryEntry[];
  categories: string[];
  categoryLabel: Record<string, string>;
  /** Its own localStorage key — see the note on favourites above. */
  storageKey: string;
  searchPlaceholder: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
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
}: {
  entry: DirectoryEntry;
  starred: boolean;
  onStar: () => void;
  categoryLabel: Record<string, string>;
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
