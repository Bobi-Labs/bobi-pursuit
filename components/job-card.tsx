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
      label: "✓ Applied",
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
  applied: [
    {
      to: "promoted",
      label: "↩ Undo",
      variant: "default",
      title: "Not actually sent — move back to Promoted",
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
      <div className="line-clamp-2 text-[12px] font-semibold leading-snug">
        {job.title}
      </div>
      {sub ? (
        <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{sub}</div>
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
        <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground">
          {job.budgetHint || "no budget"} · {relAge(job.createdAt)}
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
