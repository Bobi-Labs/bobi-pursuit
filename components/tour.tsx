"use client";

/**
 * The first-run tour.
 *
 * Onboarding asks you questions; this asks nothing. It is the thirty seconds
 * after the wizard, for the person who is now looking at a dashboard with three
 * tabs on it and no idea which one is the point. Seven stops, plain sentences,
 * and every one of them true of the free tier as shipped — a tour that describes
 * a feature this build does not have is worse than no tour, because the user
 * spends the next ten minutes hunting for it.
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
 *     seven both write the flag, because "I do not want this" is an answer and
 *     re-asking it next launch is nagging. That write lives here rather than in
 *     the caller so there is exactly one way to be marked seen.
 *
 * Storage failures are swallowed on purpose. Safari in private mode hands you a
 * `localStorage` whose `setItem` throws, and the honest consequence of that is
 * the tour showing again next time — not a crash on the one screen a new user
 * sees first.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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

/* ──────────────────────────────── Content ─────────────────────────────── */

interface TourStop {
  /** Stable key for React, and the dot rail's label. */
  key: string;
  /** Two words, for the jump dots' accessible name. */
  label: string;
  title: string;
  body: ReactNode;
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>;
}

const STOPS: readonly TourStop[] = [
  {
    key: "capture",
    label: "Capture",
    title: "Start here: capture a job",
    body: (
      <>
        <Strong>+ Capture a job</Strong> sits in the header, and it is there on
        every tab. Nothing arrives on its own in this tier, so the board stays
        empty until you put something on it. One posting is enough to see how the
        rest of this works.
      </>
    ),
  },
  {
    key: "routes",
    label: "Ways in",
    title: "Two ways in: paste a link, or use the extension",
    body: (
      <>
        By hand, you paste a title and the posting text into the capture form.
        The browser extension does the same thing from the page you are already
        reading and fills the form for you, and the bookmarklet is the version
        that needs no install. Every route is a click you make, and the same URL
        captured twice stays one card.
      </>
    ),
  },
  {
    key: "overview",
    label: "Overview",
    title: "Overview: what needs attention",
    body: (
      <>
        The tab you are on now. Four counts across the top, the highest scoring
        jobs still waiting on a decision, and how your captures are spread across
        the tracks you defined. Every number here is a button that drops you into
        the matching part of the board.
      </>
    ),
  },
  {
    key: "pipeline",
    label: "Pipeline",
    title: "Pipeline: decide once, not four times",
    body: (
      <>
        <Strong>Triage</Strong> is everything captured and undecided. Promote
        what is worth an afternoon, skip the rest, and mark{" "}
        <Strong>Applied</Strong> yourself once you have actually sent something,
        because nothing here can send it for you. Skipped jobs go to Ignored,
        which keeps them out of the way without deleting them.
      </>
    ),
  },
  {
    key: "studio",
    label: "Job Studio",
    title: "Job Studio: one job, and all the working",
    body: (
      <>
        Open any card and you get the posting, one score per track instead of a
        single averaged verdict, and the exact signals behind each number. Your
        notes live here too. If you have added an Anthropic key in Settings, this
        is also where you ask Claude to read the posting properly.
      </>
    ),
  },
  {
    key: "limits",
    label: "Good to know",
    title: "Worth knowing before you start",
    body: (
      <>
        All of this lives in this browser. There is no account and no server of
        ours, which also means clearing your browser data deletes your pipeline,
        so treat <Strong>Export</Strong> in Settings as the backup. Nothing runs
        while the tab is closed: no scrapers, no schedule, no email.
      </>
    ),
  },
  {
    key: "done",
    label: "Done",
    title: "That is the whole tool",
    body: (
      <>
        Capture, triage, decide. This tour will not show again, and{" "}
        <Strong>How it works</Strong> in the header covers all of it in more
        detail whenever you want it. Worth five minutes early on: open{" "}
        <Strong>Settings</Strong> and shape the tracks your scores come from.
      </>
    ),
  },
];

/* ───────────────────────────────── Surface ────────────────────────────── */

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const last = STOPS.length - 1;
  const stop = STOPS[Math.min(step, last)];

  /** Every way out of this component goes through here. See the file header. */
  const dismiss = useCallback(() => {
    markTourSeen();
    onClose();
  }, [onClose]);

  /* Reopening starts at the beginning. The caller is free to mount this
     permanently and flip `open`, and a tour that resumes on stop five for
     someone who deliberately left it is answering a question nobody asked. */
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  /* Escape, and the scroll lock. Both touch `document`, so both are effects —
     same shape as `Sheet` in ui.tsx, deliberately, because two overlays in one
     app that lock scrolling differently is a bug waiting for a scrollbar. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
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
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {/* Leaving by clicking away is a legitimate answer, so the backdrop is a
          real button rather than a decorative div. */}
      <button
        type="button"
        aria-label="Close the tour"
        onClick={dismiss}
        className="absolute inset-0 h-full w-full cursor-default bg-black/70"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex w-full max-w-lg flex-col rounded-[12px] border border-border bg-card shadow-2xl outline-none"
      >
        {/* ── header ── */}
        <div className="border-b border-border px-5 pb-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Step <span className="font-mono text-primary">{step + 1}</span> of{" "}
              <span className="font-mono">{STOPS.length}</span>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
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
        <div className="min-h-[132px] px-5 py-4 text-[14px] leading-relaxed text-muted-foreground">
          {stop.body}
        </div>

        {/* ── dot rail ──
            Jumping is allowed. Someone who wants stop five is telling you what
            they came for, and making them click Next four times to get it is
            the tour serving itself. */}
        <div className="flex items-center gap-1.5 px-5 pb-3.5">
          {STOPS.map((entry, index) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setStep(index)}
              aria-label={`Go to step ${index + 1}: ${entry.label}`}
              aria-current={index === step ? "step" : undefined}
              className={cx(
                "h-1.5 rounded-full transition-colors",
                index === step
                  ? "w-6 bg-primary"
                  : index < step
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
            {step > 0 ? (
              <Button size="md" onClick={() => setStep(step - 1)}>
                ← Back
              </Button>
            ) : null}
            {step < last ? (
              <Button size="md" variant="primary" onClick={() => setStep(step + 1)}>
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
