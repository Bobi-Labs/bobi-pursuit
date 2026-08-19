"use client";

/**
 * Job Studio — one job, everything known about it, and the next thing to do.
 *
 * Structurally this is the dashboard's `JobStudioPanel`: identity card with the
 * score ring on the right, a row of sub-tabs under it, and a sticky "Next
 * action" rail. What differs is what the panel *can* say, and it says only that:
 * there is no proposal drafter here, so the rail ends at "Applied", which is a
 * step only you can take.
 *
 * The centre of gravity is the **per-track breakdown**. A single fit number is a
 * lie when you are open to more than one kind of work — a posting that is a 90
 * for contract work is a 20 for a salaried role — so every track the user
 * defined gets its own row, its own number, and the exact list of signals that
 * produced it. The headline is the max of those, and the panel says so out loud
 * rather than asking you to take a number on faith.
 *
 * Presentational: every mutation leaves through a callback, so the shell owns
 * the store and this file stays testable.
 */

import { useState } from "react";

import { trackRows } from "@/lib/profile-view";
import type { Job, PipelineStatus, Profile } from "@/lib/types";
import { PIPELINE_STATUSES, PROFILE_MATCH_THRESHOLD } from "@/lib/types";

import {
  Button,
  ColorBadge,
  EmptyMini,
  INPUT,
  PanelCard,
  PanelHeader,
  ScoreChip,
  ScoreRing,
  SectionLabel,
  SubTabBtn,
  cx,
  humanFlag,
  relTime,
} from "./ui";

const STATUS_LABEL: Record<PipelineStatus, string> = {
  triage: "Triage",
  promoted: "Promoted",
  applied: "Applied",
  ignored: "Ignored",
};

const STATUS_TONE = {
  triage: "cyan",
  promoted: "green",
  applied: "blue",
  ignored: "muted",
} as const;

type StudioSub = "overview" | "scoring" | "reasoning" | "notes";

const SUBS: { key: StudioSub; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "scoring", label: "Scoring" },
  { key: "reasoning", label: "Reasoning" },
  { key: "notes", label: "Notes" },
];

/**
 * Only ever render an `href` we know is a web link. The URL can arrive from a
 * browser extension or a hand-edited import, and `javascript:` in an anchor is a
 * script-execution primitive. Anything else is shown as plain text.
 */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

export function JobStudioPanel({
  job,
  profiles,
  onStatus,
  onNotes,
  onDelete,
  onGoPipeline,
  canScoreWithClaude = false,
  scoring = false,
  scoreError = null,
  onScoreWithClaude,
  onAddKey,
}: {
  job: Job | null;
  profiles: Profile[];
  onStatus: (status: PipelineStatus) => void;
  onNotes: (notes: string) => void;
  onDelete: () => void;
  onGoPipeline: () => void;
  /** True only when an API key is set. Without one, the card offers to add one. */
  canScoreWithClaude?: boolean;
  /** Opens Settings with the key field focused. See `onAddKey` in pipeline-app. */
  onAddKey?: () => void;
  scoring?: boolean;
  /** A failed call, already phrased for a human. Rendered, never swallowed. */
  scoreError?: string | null;
  onScoreWithClaude?: () => void;
}) {
  const [sub, setSub] = useState<StudioSub>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!job) {
    return (
      <div>
        <PanelHeader
          title="Job Studio"
          sub="One job at a time: every track's verdict, the signals behind each number, the posting itself, and your notes."
        />
        <div className="py-20 text-center">
          <div className="text-[14px] font-semibold">No job open</div>
          <div className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            Pick one from the{" "}
            <button
              type="button"
              onClick={onGoPipeline}
              className="font-medium text-primary hover:underline"
            >
              Pipeline
            </button>{" "}
            — or capture a new posting and it will open here.
          </div>
        </div>
      </div>
    );
  }

  const score = job.score;
  const fit = score?.fitScore ?? null;
  const href = safeHref(job.url);
  const rows = trackRows(score, profiles);
  // The tier tell. `engine` is `"rules-…"` for the rule engine and the model id
  // for Tier 2 — the panel says which one produced the numbers, out loud,
  // because "why is this a 74" has a different answer in each case.
  const byClaude =
    score !== null && score.engine !== "" && !score.engine.startsWith("rules");
  const matchedCount = rows.filter((row) => row.matched && !row.removed).length;

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        {/* ── identity card ── */}
        <div className="mb-3.5 rounded-[12px] border border-border bg-gradient-to-br from-emerald-500/[0.04] to-blue-500/[0.02] p-4">
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap gap-1">
                <ColorBadge tone="purple">{job.source || "manual"}</ColorBadge>
                <ColorBadge tone={STATUS_TONE[job.pipelineStatus]}>
                  {STATUS_LABEL[job.pipelineStatus]}
                </ColorBadge>
                {job.location ? (
                  <ColorBadge tone="muted">{job.location}</ColorBadge>
                ) : null}
                {byClaude ? <ColorBadge tone="purple">AI scored</ColorBadge> : null}
              </div>
              <h2 className="text-[19px] font-bold leading-tight -tracking-[0.015em]">
                {job.title}
              </h2>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {job.company || "Unknown company"} ·{" "}
                {job.budgetHint || "budget undisclosed"} · added{" "}
                {relTime(job.createdAt)}
              </div>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-block text-[12px] text-primary hover:underline"
                >
                  View the original posting ↗
                </a>
              ) : job.url ? (
                <div className="mt-2 truncate font-mono text-[12px] text-text-muted">
                  {job.url}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-3 items-center gap-4 border-border text-center sm:border-l sm:pl-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tracks
                </div>
                <div className="mt-1 font-mono text-[15px] font-extrabold">
                  {score ? `${matchedCount}/${profiles.length}` : "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Engine
                </div>
                <div className="mt-1 font-mono text-[14px] font-bold leading-tight">
                  {score ? (byClaude ? "claude" : "rules") : "—"}
                </div>
              </div>
              <div>
                <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Fit
                </div>
                <ScoreRing score={fit} />
              </div>
            </div>
          </div>
        </div>

        {/* ── sub-tabs ── */}
        <div className="mb-4 flex overflow-x-auto border-b border-border">
          {SUBS.map((s) => (
            <SubTabBtn
              key={s.key}
              active={sub === s.key}
              onClick={() => setSub(s.key)}
              count={s.key === "scoring" ? rows.length : undefined}
            >
              {s.label}
            </SubTabBtn>
          ))}
        </div>

        {sub === "overview" ? <StudioOverview job={job} /> : null}
        {sub === "scoring" ? (
          <StudioScoring job={job} rows={rows} byClaude={byClaude} />
        ) : null}
        {sub === "reasoning" ? <StudioReasoning job={job} /> : null}
        {sub === "notes" ? <StudioNotes job={job} onNotes={onNotes} /> : null}
      </div>

      {/* ── next action rail ── */}
      <aside className="min-w-0 lg:sticky lg:top-2">
        <PanelCard>
          <div className="mb-3 text-[14px] font-bold">Next action</div>

          <div className="mb-3 space-y-2">
            {[
              {
                label: "Captured",
                done: true,
                note: `from ${job.source || "manual"}`,
              },
              {
                label: "Scored",
                done: score !== null,
                note: score
                  ? byClaude
                    ? "read by Claude"
                    : "rule-based — your keywords"
                  : "edit the job to score it",
              },
              {
                label: "Promoted",
                done:
                  job.pipelineStatus === "promoted" ||
                  job.pipelineStatus === "applied",
                note:
                  job.pipelineStatus === "ignored"
                    ? "skipped — restore to reconsider"
                    : job.pipelineStatus === "triage"
                      ? "your call"
                      : undefined,
              },
              {
                label: "Applied",
                done: job.pipelineStatus === "applied",
                note:
                  job.pipelineStatus === "applied"
                    ? undefined
                    : "nothing here can send it for you",
              },
            ].map((step) => (
              <div key={step.label} className="flex items-start gap-2">
                <span
                  className={cx(
                    "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[11px] font-bold leading-none",
                    step.done
                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {step.done ? "✓" : ""}
                </span>
                <div className="min-w-0">
                  <div
                    className={cx(
                      "text-[14px] font-medium",
                      step.done ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </div>
                  {step.note ? (
                    <div className="text-[14px] text-muted-foreground">
                      {step.note}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {PIPELINE_STATUSES.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={status === job.pipelineStatus ? "primary" : "default"}
                disabled={status === job.pipelineStatus}
                onClick={() => onStatus(status)}
              >
                {STATUS_LABEL[status]}
              </Button>
            ))}
          </div>

          {/* The upgrade, offered per job.
              This used to render *only* when a key was set, which meant the
              upgrade was advertised exclusively to people who had already taken
              it. Anyone who skipped the key during onboarding got a sentence
              elsewhere telling them to go and find Settings, and no way to act
              on it from the screen where the difference is actually visible.
              Both states are offered now: score it, or get the thing that scores
              it. Re-scoring something Claude already read is allowed but
              labelled as a re-run, because it costs again. */}
          {canScoreWithClaude ? (
            <div className="mt-3 border-t border-border pt-3">
              <Button
                size="md"
                className="w-full"
                variant={byClaude ? "default" : "primary"}
                disabled={scoring}
                onClick={onScoreWithClaude}
              >
                {scoring
                  ? "Asking Claude…"
                  : byClaude
                    ? "↻ Score again with Claude"
                    : "✨ Score with Claude"}
              </Button>
              <div className="mt-1.5 text-center text-[14px] leading-snug text-text-muted">
                {scoring
                  ? "One API call, a few seconds."
                  : byClaude
                    ? "Costs another call on your key."
                    : "Reads the posting against your track descriptions. ~$0.004 on your key."}
              </div>
            </div>
          ) : onAddKey ? (
            <div className="mt-3 border-t border-border pt-3">
              <Button
                size="md"
                className="w-full"
                variant="default"
                onClick={onAddKey}
              >
                ✨ Add a Claude key
              </Button>
              <div className="mt-1.5 text-center text-[14px] leading-snug text-text-muted">
                Optional. Claude reads the posting against your own description
                instead of matching keywords. Under $0.01 a job, billed by
                Anthropic.
              </div>
            </div>
          ) : null}

          {scoreError ? (
            <div className="mt-2.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[14px] leading-snug text-red-300">
              {scoreError}
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-[12px] text-text-muted">
              Updated {relTime(job.updatedAt)}
            </span>
            {confirmDelete ? (
              <span className="flex items-center gap-1.5">
                <Button size="xs" variant="danger" onClick={onDelete}>
                  Delete
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </span>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            )}
          </div>
        </PanelCard>
      </aside>
    </div>
  );
}

/* ───────────────────────────── sub-panels ───────────────────────────── */

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[8px] border border-border bg-card/55 p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cx("mt-1 truncate text-[14px]", mono && "font-mono")}>
        {value || "—"}
      </div>
    </div>
  );
}

function StudioOverview({ job }: { job: Job }) {
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-3">
        <Field label="Source" value={job.source || "manual"} />
        <Field label="Company" value={job.company} />
        <Field label="Location" value={job.location} />
        <Field label="Budget" value={job.budgetHint} mono />
        <Field label="Captured" value={relTime(job.createdAt)} />
        <Field label="Stage" value={STATUS_LABEL[job.pipelineStatus]} />
      </div>
      <div>
        <SectionLabel>The posting</SectionLabel>
        <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-[10px] border border-border bg-card/50 p-3.5 text-[14px] leading-[1.55]">
          {job.description || (
            <span className="text-muted-foreground">
              No description captured — the scorer had nothing to read, so treat
              the number next to this job as a guess.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StudioScoring({
  job,
  rows,
  byClaude,
}: {
  job: Job;
  rows: ReturnType<typeof trackRows>;
  byClaude: boolean;
}) {
  const score = job.score;
  if (!score) {
    return (
      <EmptyMini text="Not scored yet. Editing this job, or changing what you are looking for in Settings, scores it." />
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SectionLabel>
          Track fit — the headline number is the best of these
        </SectionLabel>
        <span className="mb-2 font-mono text-[12px] text-text-muted">
          {score.engine} · {relTime(score.scoredAt)}
        </span>
      </div>

      <div className="mb-4 space-y-1.5">
        {rows.map((row) => (
          <div
            key={row.id}
            className={cx(
              "rounded-[10px] border p-2.5 transition-colors",
              row.best
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-card/50",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <ColorBadge tone={row.tone} title={row.name}>
                  {row.short}
                </ColorBadge>
                <span
                  className={cx(
                    "truncate text-[14px] font-semibold",
                    row.removed && "text-muted-foreground line-through",
                  )}
                >
                  {row.name}
                </span>
                {row.best ? <ColorBadge tone="blue">best</ColorBadge> : null}
              </span>
              <ScoreChip score={row.fit} />
            </div>
            <p
              className={cx(
                "mt-1.5 text-[14px] leading-relaxed",
                row.matched ? "text-foreground/80" : "text-muted-foreground",
              )}
            >
              {row.removed
                ? "This track no longer exists — kept only so the number is not silently thrown away."
                : row.reasoning || "no signals matched this track"}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-4 text-[14px] leading-relaxed text-text-muted">
        A track counts as a match at {PROFILE_MATCH_THRESHOLD}.{" "}
        {byClaude
          ? "Claude read the posting against each track's description and wrote the lines above."
          : "These are rule-based: your keywords, matched literally, with every signal that moved the number named."}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <PanelCard>
          <SectionLabel>Green flags</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {score.greenFlags.length > 0 ? (
              score.greenFlags.map((flag) => (
                <ColorBadge key={flag} tone="green">
                  {humanFlag(flag)}
                </ColorBadge>
              ))
            ) : (
              <span className="text-[12px] text-muted-foreground">none</span>
            )}
          </div>
        </PanelCard>
        <PanelCard>
          <SectionLabel>Red flags</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {score.redFlags.length > 0 ? (
              score.redFlags.map((flag) => (
                <ColorBadge key={flag} tone="red">
                  {humanFlag(flag)}
                </ColorBadge>
              ))
            ) : (
              <span className="text-[12px] text-muted-foreground">none</span>
            )}
          </div>
        </PanelCard>
      </div>
    </div>
  );
}

function StudioReasoning({ job }: { job: Job }) {
  const score = job.score;
  return (
    <div>
      <SectionLabel>Why this scored {score?.fitScore ?? "—"}</SectionLabel>
      <div className="rounded-[10px] border border-blue-500/20 bg-blue-500/[0.06] p-3.5 text-[14px] leading-[1.55]">
        {score?.reasoning || (
          <span className="text-muted-foreground">
            Nothing recorded — this job has not been scored yet.
          </span>
        )}
      </div>
      <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
        This is the winning track&apos;s summary. The full per-track working is
        in <span className="font-semibold text-foreground">Scoring</span>, and
        every signal named there is one you can change: they come from the
        keywords and description you wrote.
      </p>
    </div>
  );
}

function StudioNotes({
  job,
  onNotes,
}: {
  job: Job;
  onNotes: (notes: string) => void;
}) {
  return (
    <div>
      <SectionLabel>Your notes</SectionLabel>
      {/* Bound straight to the store: `onNotes` commits synchronously, so the
          value round-trips within the same event and the caret never jumps. No
          local mirror means no way to lose a keystroke on close. */}
      <textarea
        value={job.notes}
        onChange={(e) => onNotes(e.target.value)}
        rows={10}
        placeholder="Who to mention, what to lead with, the question to ask first, why you passed…"
        className={cx(INPUT, "resize-y leading-relaxed")}
      />
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        Saved as you type, in this browser. Notes are never sent anywhere and are
        not read by the scorer.
      </p>
    </div>
  );
}
