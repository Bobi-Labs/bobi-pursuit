"use client";

/**
 * The first-run tour.
 *
 * Onboarding asks you questions; this asks nothing. It is the thirty seconds
 * after the wizard, for the person now looking at a dashboard with four tabs on
 * it and no idea which one is the point.
 *
 * **Eleven stops, and the shape is deliberate:** one on how jobs get in, one per
 * tab, and three on the board itself. An earlier version had seven read from the
 * same box in the middle of the same unchanging page — a slideshow with a Next
 * button, not a tour. A later one had five and named each tab without ever
 * teaching the board, which the operator caught: it stopped on Pipeline and then
 * never explained how to use it. The three board stops each ring one column and
 * name the single action that moves a card out of it.
 *
 * Two things make that work:
 *
 *  - **Each stop names the tab it is about** (`TourStop.tab`) and the shell
 *    navigates there before you read the card. The effect that consumes this
 *    lives in `pipeline-app.tsx`, because that file owns the tab-to-URL table
 *    and there should be exactly one of those.
 *  - **Each stop points at a real element** (`TourStop.anchor`), which is cut
 *    out of the scrim and ringed.
 *
 * That second point replaced a `place` field that chose a bottom corner per
 * stop, and the replacement is worth explaining because the corner version
 * looked reasonable and did not work. Navigating to the right tab and then
 * *describing* the subject in prose is still a slideshow: two stops ended up
 * saying the thing was "behind this card", one stop's comment justified its
 * corner on the theory that "the empty corner drags the eye up to it", and the
 * operator's note after using it was that it was not clear the card was talking
 * about the page he was on. It was not, because nothing on screen said so.
 *
 * Pointing at the element let the copy shrink from **279 words to 86** across
 * the five stops, which is the real win: a card that no longer has to explain
 * where a thing is can spend its words on what the thing is for. The card's own
 * position is now derived from the anchor — it takes whichever half of the
 * screen the anchor is not in — instead of being hardcoded per stop against a
 * layout that has since changed twice.
 *
 * An anchor that cannot be found degrades to a flat dim rather than throwing.
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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Type-only, and it has to stay that way: `pipeline-app` imports this module for
// real, so a value import here would close the cycle at runtime.
import type { TabKey } from "./pipeline-app";
import { Button, Steps, cx } from "./ui";

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
   * What this stop points at, as a `data-tour` value on a real element.
   *
   * This is the field that turned the tour from a slideshow into a tour. Before
   * it, the card navigated to the right tab and then described its subject in
   * prose — two stops literally said the thing was "behind this card", which is
   * copy compensating for a missing pointer, and the operator's note was that it
   * was not clear the card was even talking about the page he was on. Now the
   * element is cut out of the scrim and ringed, so the card can stop describing
   * location and just say what the thing is for.
   *
   * A miss is survivable on purpose: if the element is absent (a tab that
   * renders nothing on an empty board, a viewport that hides it), the scrim
   * falls back to a flat dim and the card still reads. A tour that throws
   * because a selector moved is worse than one that points vaguely.
   */
  anchor?: string;
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
    anchor: "capture",
    title: "Nothing arrives on its own",
    body: (
      <>
        No crawling, ever. The board stays empty until you put something on it —
        this button, the extension, or a bookmarklet.
      </>
    ),
  },
  {
    key: "overview",
    label: "Overview",
    tab: "overview",
    anchor: "overview-counts",
    title: "Start here when you come back",
    body: <>Five counts. Each one is a button into that slice of the board.</>,
  },
  {
    key: "pipeline",
    label: "Pipeline",
    tab: "pipeline",
    anchor: "tab-pipeline",
    title: "Decide once, not four times",
    body: (
      <>
        Four columns, left to right. Declined and Skipped sit behind their own
        tabs — kept, not deleted.
      </>
    ),
  },
  /* Three stops on the board itself, one per decision you actually make.
   *
   * Naming the tab was never teaching it. Each of these rings the column it
   * describes, so the words and the thing are on screen together — and each
   * names the ONE action that moves a card out, because that is the only
   * question a new user has while looking at it. */
  {
    key: "triage",
    label: "Triage",
    tab: "pipeline",
    anchor: "col-triage",
    title: "Decide, don’t read",
    body: (
      <>
        Everything captured lands here, already scored. Promote what is worth an
        afternoon, Skip the rest — fast.
      </>
    ),
  },
  {
    key: "applied",
    label: "Applied",
    tab: "pipeline",
    anchor: "col-applied",
    title: "Then it is their move",
    body: (
      <>
        Mark applied once you have actually sent it. These cards show how long
        they have been waiting, because silence is the usual answer.
      </>
    ),
  },
  {
    key: "interviewing",
    label: "Interviewing",
    tab: "pipeline",
    anchor: "col-interviewing",
    title: "When someone comes back",
    body: (
      <>
        Mark the response on the card. Nothing moves on its own — this app
        cannot read your email, so it never pretends to know.
      </>
    ),
  },
  {
    key: "studio",
    label: "Job Studio",
    tab: "studio",
    anchor: "tab-studio",
    title: "One job, and all the working",
    body: (
      <>
        One score per track instead of one averaged verdict, plus the signals
        behind each number.
      </>
    ),
  },
  {
    key: "jobsites",
    label: "Job Sites",
    tab: "jobsites",
    anchor: "tab-jobsites",
    title: "Nothing to triage yet?",
    body: (
      <>
        Seventy-six job sites with honest notes on each, and Resources next door
        for CVs, interviews and pay. Both work before you have captured
        anything.
      </>
    ),
  },
  {
    key: "searches",
    label: "Searches",
    tab: "searches",
    anchor: "tab-searches",
    title: "Keep the search, not just the job",
    body: (
      <>
        A tuned search — your salary floor, your radius, sorted by newest — is
        the work. Save it from the plugin and it lands here.
      </>
    ),
  },
  /* The plugin gets the last word, and it is the only stop describing something
   * that is not on screen — which is the point. Everything the tour has shown
   * so far assumes a job is already on the board, and this is the thing that
   * puts it there. Drawn as the same Steps used in setup rather than a
   * screenshot: a picture of a sidebar goes stale the first time the sidebar
   * changes, and this cannot. */
  {
    key: "plugin",
    label: "The plugin",
    tab: "howitworks",
    anchor: "tab-howitworks",
    title: "The plugin does both",
    body: (
      <>
        <Steps
          steps={[
            "Open a job or a search",
            "Click the plugin",
            "Capture, or Save this search",
          ]}
        />
        <div className="mt-2">
          Two buttons, and it reads a page only when you press one. Install
          links are on this tab.
        </div>
      </>
    ),
  },
  {
    key: "howitworks",
    label: "How it works",
    tab: "howitworks",
    anchor: "tab-howitworks",
    title: "The manual, and one warning",
    body: (
      <>
        Every capture route lives here. Your data stays in this browser — no
        server holds a copy, so <Strong>Export</Strong> in Settings is what
        makes it survive a lost laptop.
      </>
    ),
  },
];

/** A measured anchor: where the thing this stop points at actually is. */
interface AnchorBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Breathing room around the cut-out, so the ring never crowds the element. */
const HALO = 6;

/**
 * Measure the element a stop points at, and keep measuring it.
 *
 * Deliberately an effect rather than a ref callback: the tour navigates to a
 * tab and the element it wants may not exist in the same frame the stop
 * changes. A single measurement on mount would race that and miss, which reads
 * as the spotlight landing on nothing.
 *
 * Returns null when there is no anchor or the element is not on screen, and the
 * caller is expected to treat that as "dim everything flatly" rather than as an
 * error. See the note on `TourStop.anchor`.
 */
function useAnchorBox(anchor: string | undefined, open: boolean): AnchorBox | null {
  const [box, setBox] = useState<AnchorBox | null>(null);

  useEffect(() => {
    if (!open || !anchor) {
      setBox(null);
      return;
    }

    const measure = () => {
      const el = document.querySelector(`[data-tour="${anchor}"]`);
      if (!el) {
        // The tab this stop navigated to may still be mounting.
        setBox(null);
        return;
      }
      const r = el.getBoundingClientRect();
      // Present but not laid out yet; treat as not ready rather than as a box.
      if (r.width === 0 && r.height === 0) return;
      setBox((prev) =>
        prev &&
        prev.top === r.top &&
        prev.left === r.left &&
        prev.width === r.width &&
        prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      );
    };

    /* Re-measured on events, not on a clock, and both of the obvious clock
     * versions were written and thrown away first:
     *
     *  - Measuring **once** drew the ring 10px off the capture button. This
     *    component sets `overflow: hidden` on the body, that removes the
     *    scrollbar, and everything right-aligned in the header slides sideways
     *    *after* the single measurement lands. Close enough to look like a
     *    rounding artefact; not close enough to be pointing at anything.
     *  - Measuring **every frame** fixed it and could not be proven. Neither
     *    `requestAnimationFrame` nor `setInterval` fires dependably in a tab
     *    that is not compositing, so in a headless or backgrounded browser the
     *    tracking silently does nothing and the test reports the same stale
     *    numbers whatever the code says. A mechanism whose test passes and
     *    fails identically is not a tested mechanism.
     *
     * Observers fire on layout, not on a clock, so they work in a hidden tab
     * and are verifiable. `documentElement` is the one that matters: losing the
     * scrollbar changes its content width, which is precisely the 10px event. */
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    const anchorEl = document.querySelector(`[data-tour="${anchor}"]`);
    if (anchorEl) ro.observe(anchorEl);

    // The anchor for a stop that just navigated may not be in the DOM yet, and
    // a panel mounting under it moves everything below. Cheap because `measure`
    // bails on an unchanged box without re-rendering.
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("resize", measure);

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchor, open]);

  return box;
}

/** Half the viewport height, guarded for the build-time render in Node. */
function viewportMidpoint(): number {
  return typeof window === "undefined" ? 0 : window.innerHeight / 2;
}

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

  /* Measured here, and the position of these two lines is the fix rather than a
   * style preference.
   *
   * Hook effects run in call order. When `useAnchorBox` was called at the top of
   * this component its effect ran *before* the scroll-lock effect below, so the
   * very first measurement always read the layout as it was **with** a
   * scrollbar — and the lock then removed the scrollbar and slid everything
   * right-aligned sideways by its width. The ring drew ~10px off its button,
   * every single time, deterministically.
   *
   * Measuring after the lock is declared means the first measurement is already
   * the locked layout. The observers inside the hook stay as the safety net for
   * everything else that moves (panels mounting, the window resizing), but
   * correctness no longer depends on one of them firing.
   */
  // Measured every stop. Null is a normal outcome, not a failure — see the hook.
  const box = useAnchorBox(stop.anchor, open);

  /* Which half of the screen the card takes.
   *
   * Driven by the anchor rather than hardcoded per stop, because the old
   * hardcoded corners were chosen against a layout that has since changed twice.
   * The rule is only "get out of the way of the thing being pointed at": if the
   * anchor sits in the top half, the card goes to the bottom, and vice versa.
   * With no anchor it falls back to the bottom, which is where it always was. */
  const cardAtBottom =
    box == null ? true : box.top + box.height / 2 < viewportMidpoint();

  if (!open) return null;

  return (
    <div
      className={cx(
        "fixed inset-0 z-50 flex justify-center p-4 sm:p-6",
        cardAtBottom ? "items-end" : "items-start",
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
        className={cx(
          "absolute inset-0 h-full w-full cursor-default",
          // With an anchor the dimming is done by the cut-out below, so this
          // stays transparent and only carries the click-away behaviour. Two
          // stacked scrims would double-darken the one element we are trying to
          // make the brightest thing on screen.
          box ? "bg-transparent" : "bg-black/35",
        )}
      />

      {/* ── the spotlight ──
          One element does both jobs: an enormous spread box-shadow dims the
          entire page *except* this rectangle, and the border rings what is left.
          That is why there is no second scrim and no four-rectangle mask.

          `pointer-events-none` matters: the cut-out sits above the backdrop
          button, and without it the highlighted element would be the one place
          on screen where clicking away silently did nothing. */}
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[10px] border-2 border-primary transition-all duration-200"
          style={{
            top: box.top - HALO,
            left: box.left - HALO,
            width: box.width + HALO * 2,
            height: box.height + HALO * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      ) : null}

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
