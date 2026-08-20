"use client";

/**
 * The searches you tuned, kept in one place.
 *
 * Its own tab rather than a strip on Job Sites, because the two answer
 * different questions. Job Sites is "where could I look" — browsed once,
 * maybe twice. This is "the four searches I already tuned and come back to
 * every morning", which is a returning user's actual homepage. Burying the
 * second inside the first is what made the operator ask where saved searches
 * even were.
 *
 * **What this is not, said plainly on the page.** Nothing here runs a search,
 * polls a board or notices a new posting. The app has no server and a page in
 * your browser cannot fetch a job board cross-origin. These are your own URLs,
 * reopened in one click.
 *
 * That is less than the phrase "saved searches" implies and more than it
 * sounds. After two weeks a hunt has six tuned searches across four boards —
 * the one with the salary floor and the radius, the one filtered to the last
 * 24 hours — and no memory of which is which. The tuning is the work. Losing
 * it is the loss.
 */

import { useEffect, useState } from "react";

import {
  addSearch,
  isSafeUrl,
  readSearches,
  clearPendingSearch,
  peekPendingSearch,
  removeSearch,
  type SavedSearch,
} from "@/lib/saved-searches";
import { Button, INPUT, PanelCard, PanelHeader, Steps, cx } from "./ui";

export function SearchesPanel({
  onGoJobSites,
}: {
  onGoJobSites: () => void;
}) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [site, setSite] = useState("");

  // Browser-only: static export, no localStorage at build time.
  useEffect(() => {
    setSearches(readSearches());
  }, []);

  /* A handoff from the extension, collected on the far side of the navigation
     that brought us here.

     It lands in the FORM rather than saving itself: the extension can only
     guess a name from the page title, and an unreviewed guess is how a list
     becomes six rows all called "Jobs — LinkedIn".

     Peeks rather than consumes: this panel mounts twice on the way here,
     because goTab sets the tab optimistically before the router commits. A
     token that cleared itself on read was eaten by the first mount and missing
     from the second. It is cleared on save instead. */
  useEffect(() => {
    const pending = peekPendingSearch();
    if (!pending) return;
    setUrl(pending.url);
    setLabel(pending.label);
    setSite(pending.site);
  }, []);

  const valid = isSafeUrl(url);

  function save() {
    if (!valid) return;
    setSearches(addSearch({ label, url, site }));
    // The handoff is dealt with only now, not when it was read.
    clearPendingSearch();
    setLabel("");
    setUrl("");
    setSite("");
  }

  return (
    <div>
      <PanelHeader
        title="Searches"
        sub="The searches you already tuned, in one place. Nothing here runs a search or watches for new postings — the app has no server and cannot. These are your own links, reopened in one click."
      />

      {/* How one gets here, since the answer is "from the extension" and that
          is not guessable from this screen. */}
      <div className="mb-4">
        <Steps
          steps={[
            "Search on any job site",
            "Open the plugin",
            "Save this search",
            "It lands here",
          ]}
        />
      </div>

      <PanelCard className={cx("mb-4", url ? "border-primary/40" : undefined)}>
        <div className="mb-1.5 text-[14px] font-bold">
          {url ? "Name this search" : "Add one by hand"}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-[1fr_1.4fr_auto]">
          <input
            className={INPUT}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name it — “Remote PM, £70k+”"
          />
          <input
            className={cx(INPUT, "font-mono text-[12px]")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
          <Button size="md" variant="primary" disabled={!valid} onClick={save}>
            Save
          </Button>
        </div>
        {url && !valid ? (
          <div className="mt-1.5 text-[13px] text-amber-400">
            Needs to be a full http(s) address.
          </div>
        ) : null}
      </PanelCard>

      {searches.length === 0 ? (
        <div className="py-12 text-center">
          <div className="text-[14px] font-bold">No searches yet</div>
          <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            Tune a search on a job site — your filters, your salary floor, sorted
            by newest — then save it from the plugin. The tuning is the part
            worth keeping.
          </p>
          <div className="mt-3">
            <Button size="md" onClick={onGoJobSites}>
              Browse job sites →
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {searches.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-2 rounded-[10px] border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[14px] font-bold text-foreground transition-colors hover:text-primary"
                >
                  {s.label} ↗
                </a>
                <div className="mt-0.5 truncate font-mono text-[12px] text-text-muted">
                  {s.site || new URL(s.url).hostname.replace(/^www\./, "")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSearches(removeSearch(s.id))}
                title="Remove this search"
                className="shrink-0 rounded-md border border-border bg-card px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
