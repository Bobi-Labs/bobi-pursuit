"use client";

/**
 * A job, as it appears on the kanban and nowhere else.
 *
 * Ported from the dashboard's `KanbanCard`, down to the emerald glow a high-fit
 * card in triage wears. The card has one job (pun intended): let you decide
 * *without opening it*. That is why the fit number, the tracks it matched and
 * the first red flag are all on its face — if you have to click into a card to
 * find out whether it is worth clicking into, the board has failed and you may
 * as well have kept the browser tabs.
 *
 * Track badges come from `settings.profiles`, so they carry the user's own
 * colour and their own ≤10-character label. An id that no longer resolves
 * renders muted as "removed" rather than throwing.
 *
 * Status moves are buttons, not drag-and-drop. Deliberate: no DnD library is
 * installed, HTML5 drag events are a hydration and touch-support minefield under
 * a static export, and two taps beat a drag on a laptop trackpad anyway.
 */

import { matchedLabels } from "@/lib/profile-view";
import type { Job, PipelineStatus, Profile } from "@/lib/types";

import { ColorBadge, Button, ScoreChip, cx, humanFlag, relAge } from "./ui";

type Action = {
  to: PipelineStatus;
  label: string;
  variant: "primary" | "default";
  title: string;
};

/**
 * Where a card can go from where it is. Every column offers exactly one forward
 * move and one way out, so the board is navigable without a manual.
 */
const ACTIONS: Record<PipelineStatus, Action[]> = {
  triage: [
    {
      to: "promoted",
      label: "⚡ Promote",
      variant: "primary",
      title: "Worth pursuing — move to Promoted",
    },
    {
      to: "ignored",
      label: "Skip",
      variant: "default",
      title: "Not for you — move to Ignored",
    },
  ],
  promoted: [
    {
      to: "applied",
      // "✓ Applied" read as a label rather than a button: a card sitting in
      // Promoted appeared to be claiming the job had been applied to. Every
      // other action here is a verb — Promote, Skip, Undo, Restore — and this
      // was the only past-tense one, wearing a tick that made it look like
      // state. The board's whole promise is that nothing moves on its own, so a
      // control that looks like it already moved is the worst possible slip.
      label: "Mark applied",
      variant: "primary",
      title: "You sent it — move to Applied",
    },
    {
      to: "ignored",
      label: "Skip",
      variant: "default",
      title: "Changed your mind — move to Ignored",
    },
  ],
  // Applied stops being terminal. Its forward move is the one thing you cannot
  // do yourself — hear back — so both outcomes live here. "↩ Undo" moved into
  // Job Studio's Move-to row rather than disappearing: two outcomes and an undo
  // is three buttons on a card that already carries a budget and an age.
  applied: [
    {
      to: "interviewing",
      label: "⚡ Interviewing",
      variant: "primary",
      title: "They came back — move to Interviewing",
    },
    {
      to: "declined",
      label: "Declined",
      variant: "default",
      title: "They said no — move to Declined",
    },
  ],
  interviewing: [
    {
      to: "declined",
      label: "Declined",
      variant: "default",
      title: "It ended — move to Declined",
    },
    {
      to: "applied",
      label: "↩ Back",
      variant: "default",
      title: "Mis-tapped — move back to Applied",
    },
  ],
  // Reopening goes to Applied, not Triage: you did send it, and pretending
  // otherwise would lose that from the archive.
  declined: [
    {
      to: "applied",
      label: "↺ Reopen",
      variant: "default",
      title: "Back in play — move to Applied",
    },
  ],
  ignored: [
    {
      to: "triage",
      label: "↺ Restore",
      variant: "default",
      title: "Put this back in Triage",
    },
  ],
};

/**
 * How loud the waiting figure is. Three weeks is the threshold because that is
 * roughly when a silent application stops being "early" and starts being an
 * answer — but it is a colour, not a decision: nothing moves off the board on
 * its own, ever.
 */
function waitingTone(since: string): string {
  const days = (Date.now() - new Date(since).getTime()) / 86_400_000;
  if (!Number.isFinite(days)) return "";
  return days >= 21 ? "text-amber-400" : "";
}

export function JobCard({
  job,
  profiles,
  active,
  onOpen,
  onStatus,
}: {
  job: Job;
  profiles: Profile[];
  active: boolean;
  onOpen: () => void;
  onStatus: (status: PipelineStatus) => void;
}) {
  const score = job.score;
  const fit = score?.fitScore ?? null;
  // 75+ with nothing done about it yet is the one state worth shouting about.
  const glow = job.pipelineStatus === "triage" && (fit ?? 0) >= 75;
  const sub = [job.company, job.source].filter(Boolean).join(" · ");
  const tracks = matchedLabels(score, profiles).slice(0, 2);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cx(
        "block w-full cursor-pointer rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-muted/50",
        active
          ? "border-emerald-500/60 ring-1 ring-emerald-500/20"
          : glow
            ? "glow-primary border-emerald-500/40"
            : "border-border",
      )}
    >
      <div className="line-clamp-2 text-[14px] font-semibold leading-snug">
        {job.title}
      </div>
      {sub ? (
        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{sub}</div>
      ) : null}

      <div className="mt-1.5 flex flex-wrap gap-1">
        <ScoreChip score={fit} />
        {tracks.map((track) => (
          <ColorBadge key={track.id} tone={track.tone} title={track.name}>
            {track.short}
          </ColorBadge>
        ))}
        {score?.redFlags.slice(0, 1).map((flag) => (
          <ColorBadge key={flag} tone="red">
            {humanFlag(flag)}
          </ColorBadge>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[12px] text-muted-foreground">
          {job.budgetHint || "no budget"} · {relAge(job.createdAt)}
          {/* Silence is the usual outcome of an application, and an Applied
              column with no clock becomes twenty identical cards you cannot
              rank. This reads from statusChangedAt, NOT updatedAt: updatedAt
              moves when you type a note, so it would reset to zero on the job
              you are chasing hardest — exactly backwards.

              Applied only. On Interviewing something is already happening, and
              on the closed piles the wait is over. It moves nothing and
              archives nothing; the click stays yours. */}
          {job.pipelineStatus === "applied" ? (
            <>
              {" · "}
              <span className={waitingTone(job.statusChangedAt)}>
                waiting {relAge(job.statusChangedAt)}
              </span>
            </>
          ) : null}
        </span>
        <span
          className="flex shrink-0 items-center gap-1"
          // The card itself is the "open" target; the buttons are not.
          onClick={(e) => e.stopPropagation()}
        >
          {ACTIONS[job.pipelineStatus].map((action) => (
            <Button
              key={action.to}
              size="xs"
              variant={action.variant}
              title={action.title}
              onClick={() => onStatus(action.to)}
            >
              {action.label}
            </Button>
          ))}
        </span>
      </div>
    </div>
  );
}
