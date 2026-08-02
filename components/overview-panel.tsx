"use client";

/**
 * Overview — "what needs attention", in the dashboard's own layout.
 *
 * Four KPI cards, a list of the highest-fit jobs still sitting in triage, a
 * per-track distribution, and the explainer. Same shape as the self-hosted
 * `OverviewPanel`; different contents, because the questions this tier can
 * honestly answer are different. There is no "source health" card here — there
 * are no sources — and there is no trend line, because a local pipeline with no
 * outcome history has nothing to trend.
 *
 * The KPI cards are buttons: every number on this screen is a filter you can
 * fall into. A count you cannot click is a number you have to act on somewhere
 * else, which is how a dashboard becomes decoration.
 */

import { trackDistribution } from "@/lib/profile-view";
import type { Job, PipelineStatus, Profile } from "@/lib/types";
import { PROFILE_MATCH_THRESHOLD } from "@/lib/types";

import { HowItWorksPanel } from "./how-it-works";
import {
  Button,
  ColorBadge,
  EmptyMini,
  KpiCard,
  PanelCard,
  PanelHeader,
  ScoreChip,
  cx,
  humanFlag,
  relAge,
} from "./ui";

export function OverviewPanel({
  jobs,
  profiles,
  onOpenJob,
  onGoPipeline,
  onCapture,
  onLoadSample,
  onOpenSettings,
}: {
  jobs: Job[];
  profiles: Profile[];
  onOpenJob: (id: string) => void;
  /** Jumps to Pipeline, optionally landing on a stage. */
  onGoPipeline: (status?: PipelineStatus) => void;
  onCapture: () => void;
  onLoadSample: () => void;
  onOpenSettings: () => void;
}) {
  const triage = jobs.filter((job) => job.pipelineStatus === "triage");
  const promoted = jobs.filter((job) => job.pipelineStatus === "promoted");
  const applied = jobs.filter((job) => job.pipelineStatus === "applied");

  const topToReview = [...triage]
    .sort((a, b) => (b.score?.fitScore ?? -1) - (a.score?.fitScore ?? -1))
    .slice(0, 6);
  const strong = triage.filter((job) => (job.score?.fitScore ?? 0) >= 75).length;
  const distribution = trackDistribution(jobs, profiles);
  const maxMatched = distribution.reduce(
    (best, entry) => Math.max(best, entry.matched),
    0,
  );

  return (
    <div>
      <PanelHeader
        title="What needs attention"
        sub="Everything you have captured, what is still waiting on a decision, and which of your tracks the good stuff is actually landing in. Nothing here moves on its own — this tier has no scrapers and no cron, by design."
        actions={
          <Button size="sm" variant="primary" onClick={onCapture}>
            + Capture a job
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Captured"
          value={String(jobs.length)}
          delta={jobs.length === 0 ? "nothing yet" : "in this browser only"}
          deltaTone="muted"
          onClick={() => onGoPipeline()}
        />
        <KpiCard
          label="Needs review"
          value={String(triage.length)}
          delta={
            triage.length === 0
              ? "triage is clear"
              : strong > 0
                ? `${strong} at 75+`
                : "none above 75"
          }
          deltaTone={strong > 0 ? "good" : triage.length > 0 ? "warn" : "muted"}
          onClick={() => onGoPipeline("triage")}
        />
        <KpiCard
          label="Promoted"
          value={String(promoted.length)}
          delta={promoted.length ? "worth an afternoon" : "nothing promoted"}
          deltaTone={promoted.length ? "good" : "muted"}
          onClick={() => onGoPipeline("promoted")}
        />
        <KpiCard
          label="Applied"
          value={String(applied.length)}
          delta={applied.length ? "you sent these" : "you mark these yourself"}
          deltaTone={applied.length ? "good" : "muted"}
          onClick={() => onGoPipeline("applied")}
        />
      </div>

      {jobs.length === 0 ? (
        <PanelCard className="mb-5">
          <div className="py-8 text-center">
            <div className="text-[14px] font-bold">Nothing captured yet</div>
            <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
              Jobs get in here by capture, not by crawl. Grab one from a posting
              you are already looking at — or load the sample pipeline and see
              what a scored board looks like before committing to anything.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="md" variant="primary" onClick={onLoadSample}>
                Load sample data
              </Button>
              <Button size="md" onClick={onCapture}>
                Capture your first job
              </Button>
            </div>
          </div>
        </PanelCard>
      ) : (
        <div className="mb-5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.3fr_1fr]">
          {/* ── the queue ── */}
          <PanelCard>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[14px] font-bold">Top to review</div>
              <button
                type="button"
                onClick={() => onGoPipeline("triage")}
                className="text-[12px] text-primary hover:underline"
              >
                Open Pipeline →
              </button>
            </div>
            {topToReview.length === 0 ? (
              <EmptyMini text="Triage is empty — everything captured has been decided." />
            ) : (
              topToReview.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => onOpenJob(job.id)}
                  className="mb-2 block w-full rounded-[9px] border border-border bg-card/60 p-3 text-left transition-colors last:mb-0 hover:bg-muted/40"
                >
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold">
                        {job.title}
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                        {[job.company, job.source].filter(Boolean).join(" · ") ||
                          "no company"}{" "}
                        · {job.budgetHint || "budget undisclosed"}
                      </div>
                    </div>
                    <ScoreChip score={job.score?.fitScore ?? null} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {job.score?.greenFlags.slice(0, 2).map((flag) => (
                      <ColorBadge key={flag} tone="green">
                        {humanFlag(flag)}
                      </ColorBadge>
                    ))}
                    {job.score?.redFlags.slice(0, 1).map((flag) => (
                      <ColorBadge key={flag} tone="red">
                        {humanFlag(flag)}
                      </ColorBadge>
                    ))}
                    <span className="ml-auto font-mono text-[12px] text-text-muted">
                      {relAge(job.createdAt)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </PanelCard>

          {/* ── where the fits live ── */}
          <PanelCard>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[14px] font-bold">Your tracks</div>
              <button
                type="button"
                onClick={onOpenSettings}
                className="text-[12px] text-primary hover:underline"
              >
                Edit tracks →
              </button>
            </div>
            <div className="space-y-3">
              {distribution.map((track) => {
                const pct =
                  maxMatched === 0
                    ? 0
                    : Math.round((track.matched / maxMatched) * 100);
                return (
                  <div key={track.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ColorBadge tone={track.tone} title={track.name}>
                          {track.short}
                        </ColorBadge>
                        <span className="truncate text-[14px] font-medium">
                          {track.name}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[12px] font-bold">
                        {track.matched}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cx("h-full rounded-full", BAR_TONE[track.tone])}
                        style={{ width: `${Math.max(pct, track.matched > 0 ? 6 : 0)}%` }}
                      />
                    </div>
                    <div className="mt-1 font-mono text-[12px] text-text-muted">
                      avg {track.average} · best {track.best}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3.5 border-t border-border pt-3 text-[14px] leading-relaxed text-muted-foreground">
              A job counts for a track at {PROFILE_MATCH_THRESHOLD}+, and one job
              can count for several — the question is what share of what you
              capture is each kind of work, not which bucket won.
            </p>
          </PanelCard>
        </div>
      )}

      <HowItWorksPanel />
    </div>
  );
}

/** Bar fills, matched to the badge ramp in `ui.tsx`. */
const BAR_TONE: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  purple: "bg-violet-500",
  cyan: "bg-cyan-500",
  rose: "bg-rose-500",
  muted: "bg-muted-foreground",
};
