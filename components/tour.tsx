"use client";

/**
 * The first-run tour.
 *
 * Onboarding asks you questions; this asks nothing. It is the thirty seconds
 * after the wizard, for the person now looking at a dashboard with four tabs on
 * it and no idea which one is the point.
 *
 * **Five stops, and the shape is deliberate:** one on how jobs get in, then one
 * per tab saying what that area is for and how to use it. The version before
 * this had seven, and all seven were read from the same box in the middle of the
 * same unchanging page — which is a slideshow with a Next button, not a tour.
 * Two things changed:
 *
 *  - **Each stop names the tab it is about** (`TourStop.tab`) and the shell
 *    navigates there before you read the card. The effect that consumes this
 *    lives in `pipeline-app.tsx`, because that file owns the tab-to-URL table
 *    and there should be exactly one of those.
 *  - **The card sits in a bottom corner**, never dead centre. The app's content
 *    is top-anchored (banner, tabs, then the panel), so a bottom corner is the
 *    position that covers least of what the stop just promised to show you, and
 *    `TourStop.place` picks the corner away from whatever the stop points at.
 *
 * The backdrop is dimmed only lightly for the same reason. A 70% scrim was fine
 * when there was nothing behind the card worth looking at; now there is.
 *
 * Every sentence in `TOUR_STOPS` is true of the free tier as shipped. This tier
 * captures by hand — one deliberate click, via the extension, the bookmarklet or
 * a paste — and cannot fetch or scrape a posting at all. An Anthropic key
 * changes how an already-captured posting is *scored* and nothing else, and
 * nothing runs while the tab is closed. A tour that describes a feature this
 * build does not have is worse than no tour, because the user spends the next
 * ten minutes hunting for it.
 *
 * Three rules it obeys:
 *
 *  1. **Nothing reads storage during render.** The app is statically exported,
 *     so this file runs once in Node at build time. `shouldShowTour()` is a
 *     helper the caller invokes from an effect, and it still guards `window`
 *     itself — a component calling it in a `useState` initialiser would produce
 *     a first client render that disagrees with the prerendered HTML, which is
 *     the hydration mismatch React "fixes" by rendering the wrong tree.
 *  2. **It never traps you.** Escape closes, the backdrop closes, Skip is on
 *     every stop, and the dots let you jump. A modal you cannot leave is how a
 *     tour becomes the first thing someone dislikes about the product.
 *  3. **Any exit counts as seen.** Skipping on stop one and finishing on stop
 *     five both write the flag, because "I do not want this" is an answer and
 *     re-asking it next launch is nagging. That write lives here rather than in
 *     the caller so there is exactly one way to be marked seen.
 *
 * What this component deliberately does **not** own is `open` and `step`. Moving
 * between tabs is a route change, and a route change remounts the whole shell
 * (see `ViewSession` in `pipeline-app.tsx`) — local `useState` here would be
 * wiped by the tour's own first navigation, and the tour would restart at stop
 * one forever. Both live in that one session object with everything else that
 * has to outlive a route change.
 *
 * Storage failures are swallowed on purpose. Safari in private mode hands you a
 * `localStorage` whose `setItem` throws, and the honest consequence of that is
 * the tour showing again next time — not a crash on the one screen a new user
 * sees first.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";

// Type-only, and it has to stay that way: `pipeline-app` imports this module for
// real, so a value import here would close the cycle at runtime.
import type { TabKey } from "./pipeline-app";
import { Button, cx } from "./ui";

/** One flag, one key. Namespaced so it never collides with `pursuit.doc`. */
export const TOUR_SEEN_KEY = "bp.tourSeen";

/**
 * Has this browser never seen the tour?
 *
 * Returns `false` on the server so the prerendered document never contains a
 * tour, and `false` on any storage error — the failure mode of a broken read
 * should be "no overlay", not "overlay on every load".
 *
 * Browser-only. Call it from an effect, never during render.
 */
export function shouldShowTour(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TOUR_SEEN_KEY) !== "1";
  } catch {
    return false;
  }
}

/**
 * Write the flag. `Tour` calls this itself on every exit path, so the caller
 * only needs it for the unusual case: suppressing the tour from somewhere else,
 * like a capture link that arrives with a job already in hand.
 */
export function markTourSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // Storage is unavailable or full. The pipeline itself surfaces that in the
    // status line; a tour flag is not worth a second error message.
  }
}

/**
 * Forget that this browser ever saw the tour.
 *
 * Exactly one caller: "delete everything" in Settings. "It never shows twice" is
 * a promise about nagging, not about the flag being immortal — someone who has
 * just wiped the app is asking for the app they would have got on day one, and
 * arriving at an empty board with no setup and no explanation is precisely the
 * from-scratch run that was reported broken.
 *
 * Browser-only, same as its two neighbours. Call it from an effect or a handler.
 */
export function resetTourSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOUR_SEEN_KEY);
  } catch {
    // Same trade as markTourSeen: a storage failure costs a tour, not a screen.
  }
}

/* ──────────────────────────────── Content ─────────────────────────────── */

export interface TourStop {
  /** Stable key for React, and part of the jump dots' accessible name. */
  key: string;
  /** Two words. Shown next to the step counter so the card names its screen. */
  label: string;
  /** The tab this stop is about. The shell navigates here before you read it. */
  tab: TabKey;
  /**
   * Which bottom corner the card takes. Both are bottom corners because the
   * content this tour exists to point at starts at the top of the page; left vs
   * right is only ever "the corner furthest from what this stop is describing".
   */
  place: "left" | "right";
  title: string;
  body: ReactNode;
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>;
}

/**
 * The five stops, in tab order after the first.
 *
 * Exported because `pipeline-app.tsx` reads `.tab` to drive the address bar. It
 * is the only field anything outside this file touches.
 */
export const TOUR_STOPS: readonly TourStop[] = [
  {
    key: "capture",
    label: "Getting jobs in",
    tab: "overview",
    // Left, alone among the five: this is the one stop whose subject is fixed in
    // the top-right of the screen, and the empty corner drags the eye up to it.
    place: "left",
    title: "Nothing arrives on its own",
    body: (
      <>
        There are no scrapers here and nothing runs while this tab is closed, so
        the board stays empty until you put something on it.{" "}
        <Strong>+ Capture a job</Strong> sits in the header on every tab. The
        browser extension and the bookmarklet do the same job in one click from a
        posting you already have open, and the same URL captured twice stays one
        card.
      </>
    ),
  },
  {
    key: "overview",
    label: "Overview",
    tab: "overview",
    place: "right",
    title: "Overview: what needs attention",
    body: (
      <>
        Behind this card: four counts, the strongest jobs still waiting on a
        decision, and how your captures spread across your tracks. Every number
        here is a button that drops you into the matching slice of the board.
        Open this tab first when you come back to a pile you have not looked at
        in a week.
      </>
    ),
  },
  {
    key: "pipeline",
    label: "Pipeline",
    tab: "pipeline",
    place: "right",
    title: "Pipeline: decide once, not four times",
    body: (
      <>
        This is the board. <Strong>Triage</Strong> is everything captured and
        undecided: promote what is worth an afternoon, skip the rest, and do it
        fast. <Strong>Applied</Strong> is a step only you can take, because
        nothing here can send anything for you. Skipped jobs go to Ignored, kept
        and restorable rather than deleted.
      </>
    ),
  },
  {
    key: "studio",
    label: "Job Studio",
    tab: "studio",
    place: "right",
    title: "Job Studio: one job, and all the working",
    body: (
      <>
        Open any card and it lands here: the posting, one score per track instead
        of a single averaged verdict, the signals behind each number, and your
        notes. Add an Anthropic key in <Strong>Settings</Strong> and you can ask
        Claude to read a posting properly. That re-reads what you captured; it
        never goes and fetches one.
      </>
    ),
  },
  {
    key: "howitworks",
    label: "How it works",
    tab: "howitworks",
    place: "right",
    title: "How it works: the long version",
    body: (
      <>
        The tab behind this card is the manual: every capture route including the
        bookmarklet to copy, what scoring does with and without a key, and where
        your data lives. That last part is worth knowing now. All of it stays in
        this browser, so <Strong>Export</Strong> in Settings is the only backup
        you have, and clearing your browser data clears the pipeline.
      </>
    ),
  },
];

/** Bottom corner on a real screen; a bottom sheet on a phone, where there is no corner to take. */
const PLACE: Record<TourStop["place"], string> = {
  left: "sm:justify-start",
  right: "sm:justify-end",
};

/* ───────────────────────────────── Surface ────────────────────────────── */

export function Tour({
  open,
  step,
  onStep,
  onClose,
}: {
  open: boolean;
  /** Controlled by the shell, because a route change destroys local state. */
  step: number;
  onStep: (next: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  const last = TOUR_STOPS.length - 1;
  // Clamped rather than trusted: `step` crosses a component boundary and an
  // out-of-range index here would be a blank card on someone's first minute.
  const index = Math.min(Math.max(step, 0), last);
  const stop = TOUR_STOPS[index];

  /** Every way out of this component goes through here. See the file header. */
  const dismiss = useCallback(() => {
    markTourSeen();
    onClose();
  }, [onClose]);

  /* Escape, and the scroll lock.
   *
   * Unlike `Sheet` in ui.tsx this does not capture and restore the previous
   * overflow value. This component unmounts and remounts every time the tour
   * changes tab, and if a new mount ever ran before the old cleanup it would
   * capture "hidden" and then restore it forever. Clearing outright can at worst
   * unlock the background one frame early; capturing can at worst leave the
   * whole page unscrollable after the tour is gone. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, dismiss]);

  /* Move focus into the dialog so the keyboard lands somewhere sensible and the
     Escape above is reachable without a click first. The panel takes it rather
     than a button, so nothing is pre-armed for a stray Enter. */
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cx(
        // `items-end` on every breakpoint: the card belongs at the bottom of the
        // screen because everything it describes begins at the top of it.
        "fixed inset-0 z-50 flex items-end justify-center p-4 sm:p-6",
        PLACE[stop.place],
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {/* Leaving by clicking away is a legitimate answer, so the backdrop is a
          real button rather than a decorative div. Dimmed at 35% rather than the
          70% it used to be: the page behind is now the point of the stop, and a
          scrim heavy enough to hide it would undo the navigation. */}
      <button
        type="button"
        aria-label="Close the tour"
        onClick={dismiss}
        className="absolute inset-0 h-full w-full cursor-default bg-black/35"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex w-full max-w-md flex-col rounded-[12px] border border-border bg-card shadow-2xl outline-none"
      >
        {/* ── header ── */}
        <div className="border-b border-border px-5 pb-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Step <span className="font-mono text-primary">{index + 1}</span> of{" "}
              <span className="font-mono">{TOUR_STOPS.length}</span>
              {/* The screen name, because the card and the thing it describes are
                  now two different surfaces and the tie has to be said out loud. */}
              <span className="text-text-muted"> · {stop.label}</span>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Skip ✕
            </button>
          </div>
          <h2
            id="tour-title"
            className="mt-1.5 text-base font-bold -tracking-[0.01em]"
          >
            {stop.title}
          </h2>
        </div>

        {/* ── body ──
            Fixed minimum height so Back and Next do not walk up and down the
            screen between a three-line stop and a five-line one. */}
        <div className="min-h-[128px] px-5 py-4 text-[14px] leading-relaxed text-muted-foreground">
          {stop.body}
        </div>

        {/* ── dot rail ──
            Jumping is allowed. Someone who wants stop four is telling you what
            they came for, and making them click Next three times to get it is
            the tour serving itself. */}
        <div className="flex items-center gap-1.5 px-5 pb-3.5">
          {TOUR_STOPS.map((entry, i) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => onStep(i)}
              aria-label={`Go to step ${i + 1}: ${entry.label}`}
              aria-current={i === index ? "step" : undefined}
              className={cx(
                "h-1.5 rounded-full transition-colors",
                i === index
                  ? "w-6 bg-primary"
                  : i < index
                    ? "w-3 bg-emerald-500/40 hover:bg-emerald-500/70"
                    : "w-3 bg-border hover:bg-muted-foreground/50",
              )}
            />
          ))}
        </div>

        {/* ── footer ── */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="text-[12px] text-text-muted">
            Nothing is uploaded.
          </span>
          <span className="flex items-center gap-1.5">
            {index > 0 ? (
              <Button size="md" onClick={() => onStep(index - 1)}>
                ← Back
              </Button>
            ) : null}
            {index < last ? (
              <Button size="md" variant="primary" onClick={() => onStep(index + 1)}>
                Next →
              </Button>
            ) : (
              <Button size="md" variant="solid" onClick={dismiss}>
                Start using it →
              </Button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
