"use client";

/**
 * The studio shell — header, folder tabs, three panels, status line.
 *
 * This is the same surface as the self-hosted Bobi dashboard, at a different
 * price point: the banner, the raised folder tabs, the kanban, the Job Studio
 * rail. Anyone who has used one should recognise the other instantly, which is
 * the whole point of a free tier that advertises a paid one. Sources,
 * Intelligence and Stats are *absent* rather than faked — this tier has no
 * scrapers to report on and no outcome history to chart, and a tab full of
 * plausible zeroes would be a lie with a chart on it.
 *
 * ⚠️ The rule this file is arranged around: **the app is statically exported, so
 * every line below runs once in Node at build time.** Nothing reads
 * `localStorage`, `window` or `document` during render. `store.init()` and the
 * `?add=1` capture handoff both happen inside the mount effect, one frame after
 * hydration, and until `status.loaded` flips we render a skeleton rather than an
 * empty state — "you have no jobs" flashing in front of someone who has two
 * hundred is how a local-first tool loses trust in the first second.
 *
 * View state lives here (tab, selection, filters, which sheet is open). Data
 * mutations go through the store singleton. There is no context and no provider,
 * because there is exactly one document per tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { parseCaptureParams, type CaptureParams } from "@/lib/capture";
import { matchedLabels } from "@/lib/profile-view";
import { scoreJobWithClaude } from "@/lib/scoring/llm-scorer";
import { store } from "@/lib/store/store";
import { usePipeline, useStoreStatus } from "@/lib/store/use-pipeline";
import { STARTER_PROFILE_ID, type Job, type PipelineStatus, type Profile } from "@/lib/types";

import { AddJobSheet, type AddResult, type NewJobInput } from "./add-job-sheet";
import { HowItWorksSheet } from "./how-it-works";
import { JobCard } from "./job-card";
import { JobStudioPanel } from "./job-detail";
import { Onboarding } from "./onboarding";
import { OverviewPanel } from "./overview-panel";
import { SettingsSheet } from "./settings-sheet";
import {
  Button,
  Chip,
  ColorBadge,
  Dot,
  FolderPanel,
  FolderTabs,
  INPUT,
  KanbanCol,
  PanelHeader,
  ScoreChip,
  SubTabBtn,
  ViewToggle,
  cx,
  relAge,
  relTime,
  type FolderTab,
} from "./ui";

type TabKey = "overview" | "pipeline" | "studio";
type View = "kanban" | "table";
type SortKey = "fit" | "newest";
type BoardStatus = Exclude<PipelineStatus, "ignored">;

const TABS: FolderTab<TabKey>[] = [
  { key: "overview", label: "Overview" },
  { key: "pipeline", label: "Pipeline" },
  { key: "studio", label: "Job Studio" },
];

const COLUMNS: { status: BoardStatus; label: string; hint: string }[] = [
  { status: "triage", label: "Triage", hint: "Everything new. Decide, don’t read." },
  { status: "promoted", label: "Promoted", hint: "Worth an afternoon." },
  { status: "applied", label: "Applied", hint: "You sent it." },
];

const STATUS_TONE = {
  triage: "cyan",
  promoted: "green",
  applied: "blue",
  ignored: "muted",
} as const;

/** Query params the capture link owns. Scrubbed after use so a refresh is inert. */
const CAPTURE_PARAMS = ["add", "t", "u", "d", "b", "s", "c"];

export default function PipelineApp() {
  const doc = usePipeline();
  const status = useStoreStatus();
  const profiles = doc.settings.profiles;

  const [tab, setTab] = useState<TabKey>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("kanban");
  const [sub, setSub] = useState<"working" | "ignored">("working");
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState<string>("all");
  const [minFit, setMinFit] = useState(0);
  const [sort, setSort] = useState<SortKey>("fit");
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<CaptureParams | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  /**
   * First run is decided **once**, the moment storage answers, and never again.
   *
   * The obvious version — deriving "is this a fresh document?" on every render —
   * unmounts itself halfway through: step 1 commits the user's tracks, the
   * document stops looking fresh, and the wizard vanishes mid-sentence. Latching
   * it behind a ref is what makes the flow survive its own first side effect.
   */
  const onboardingSettled = useRef(false);
  /* Tier 2, one job at a time. The id (not a boolean) so switching jobs mid-call
     cannot leave a second panel showing a pending state that isn't its own. */
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const llmAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => llmAbortRef.current?.abort(), []);

  /* ── mount: read storage, then honour a capture link ────────────────────
   * Both are browser-only, so both live here rather than in a lazy `useState`
   * initialiser — an initialiser runs during the first client render, and a
   * first render that disagrees with the prerendered HTML is a hydration
   * mismatch React "fixes" by silently rendering the wrong tree. */
  useEffect(() => {
    void store.init();

    const captured = parseCaptureParams(window.location.search);
    if (!captured) return;

    setPrefill(captured);
    setAddOpen(true);
    // Someone arriving with a job in hand has answered the "what is this"
    // question by doing it. Setup would be in the way.
    onboardingSettled.current = true;

    // Scrub the handoff out of the address bar. Without this, a refresh (or a
    // restored tab) re-opens the sheet with the same posting forever.
    const url = new URL(window.location.href);
    for (const key of CAPTURE_PARAMS) url.searchParams.delete(key);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, []);

  /* ── filtering ── */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return doc.jobs.filter((job) => {
      if ((job.score?.fitScore ?? 0) < minFit) return false;
      if (track !== "all" && !(job.score?.matchedProfiles ?? []).includes(track)) {
        return false;
      }
      if (!q) return true;
      return [
        job.title,
        job.company,
        job.source,
        job.location,
        job.budgetHint,
        job.notes,
        job.description,
      ].some((field) => field.toLowerCase().includes(q));
    });
  }, [doc.jobs, query, track, minFit]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      if (sort === "fit") {
        const delta = (b.score?.fitScore ?? -1) - (a.score?.fitScore ?? -1);
        if (delta !== 0) return delta;
      }
      return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    });
    return list;
  }, [filtered, sort]);

  const grouped = useMemo(() => {
    const groups: Record<PipelineStatus, Job[]> = {
      triage: [],
      promoted: [],
      applied: [],
      ignored: [],
    };
    for (const job of sorted) groups[job.pipelineStatus].push(job);
    return groups;
  }, [sorted]);

  const working = useMemo(
    () => sorted.filter((job) => job.pipelineStatus !== "ignored"),
    [sorted],
  );

  const selected = useMemo(
    () => doc.jobs.find((job) => job.id === selectedId) ?? null,
    [doc.jobs, selectedId],
  );

  const filtersActive = query.trim() !== "" || track !== "all" || minFit > 0;
  const triageCount = doc.jobs.filter((job) => job.pipelineStatus === "triage").length;
  const promotedCount = doc.jobs.filter(
    (job) => job.pipelineStatus === "promoted",
  ).length;

  /* ── mutations ── */

  const openJob = useCallback((id: string) => {
    setSelectedId(id);
    setTab("studio");
  }, []);

  const goPipeline = useCallback((stage?: PipelineStatus) => {
    setTab("pipeline");
    setSub(stage === "ignored" ? "ignored" : "working");
  }, []);

  const handleAdd = useCallback((input: NewJobInput): AddResult => {
    const existing = input.url.trim() ? store.findByUrl(input.url) : undefined;
    if (existing) return { job: existing, duplicate: true };
    return { job: store.addJob(input), duplicate: false };
  }, []);

  /**
   * Score one job with the user's key. Failures land next to the job that
   * failed — an API error the user cannot see is an API error they will pay to
   * repeat.
   */
  const scoreWithClaude = useCallback(async (job: Job) => {
    const controller = new AbortController();
    llmAbortRef.current = controller;
    setScoringId(job.id);
    setScoreError(null);

    const result = await scoreJobWithClaude(job, store.getSnapshot().settings, {
      signal: controller.signal,
    });

    llmAbortRef.current = null;
    setScoringId(null);
    if (result.ok) {
      store.setScore(job.id, result.score);
    } else if (result.kind !== "cancelled") {
      setScoreError({ id: job.id, message: result.message });
    }
  }, []);

  const clearFilters = () => {
    setQuery("");
    setTrack("all");
    setMinFit(0);
  };

  /* First run: a loaded, empty document still carrying the shipped starter
     track. Evaluated once — see `onboardingSettled` — so nothing needs a
     "you have seen this" flag in storage, and picking your tracks in step 1
     does not yank the wizard out from under you. */
  useEffect(() => {
    if (onboardingSettled.current || !status.loaded) return;
    onboardingSettled.current = true;
    const firstRun =
      doc.jobs.length === 0 &&
      profiles.length === 1 &&
      profiles[0].id === STARTER_PROFILE_ID;
    if (firstRun) setOnboardingOpen(true);
  }, [status.loaded, doc.jobs.length, profiles]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* ═══ banner ═══ */}
      <header className="relative overflow-hidden border-b border-border px-4 pb-4 pt-5 sm:px-6">
        <div aria-hidden className="banner-mesh absolute inset-0" />
        <div aria-hidden className="banner-grid absolute inset-0 opacity-50" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
              Bobi Labs · local-first
            </div>
            <h1 className="text-2xl font-bold -tracking-[0.02em]">
              Bobi<span className="text-emerald-400">·</span>Pursuit
            </h1>
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              {doc.jobs.length} captured · {triageCount} to review ·{" "}
              {promotedCount} promoted · no accounts · no server of ours
            </div>
          </div>
          <div className="relative flex flex-wrap items-center gap-1.5">
            <Button size="md" variant="primary" onClick={() => setAddOpen(true)}>
              + Capture a job
            </Button>
            <Button size="md" onClick={() => setHowOpen(true)}>
              How it works
            </Button>
            <Button size="md" onClick={() => setSettingsOpen(true)}>
              Settings
            </Button>
          </div>
        </div>
      </header>

      {/* ═══ folder tabs + panel ═══ */}
      <div className="flex-1 px-4 pb-12 pt-3 sm:px-6">
        <FolderTabs
          tabs={TABS}
          active={tab}
          counts={{ pipeline: working.length }}
          onChange={setTab}
        />
        <FolderPanel className="min-h-[680px]">
          {!status.loaded ? (
            <Skeleton />
          ) : tab === "overview" ? (
            <OverviewPanel
              jobs={doc.jobs}
              profiles={profiles}
              onOpenJob={openJob}
              onGoPipeline={goPipeline}
              onCapture={() => setAddOpen(true)}
              onLoadSample={() => store.loadSample()}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : tab === "pipeline" ? (
            <PipelinePanel
              totalJobs={doc.jobs.length}
              grouped={grouped}
              working={working}
              profiles={profiles}
              selectedId={selectedId}
              view={view}
              onView={setView}
              sub={sub}
              onSub={setSub}
              query={query}
              onQuery={setQuery}
              track={track}
              onTrack={setTrack}
              minFit={minFit}
              onMinFit={setMinFit}
              sort={sort}
              onSort={setSort}
              filtersActive={filtersActive}
              onClearFilters={clearFilters}
              onOpenJob={openJob}
              onStatus={(id, next) => store.setPipelineStatus(id, next)}
              onCapture={() => setAddOpen(true)}
              onLoadSample={() => store.loadSample()}
            />
          ) : (
            <JobStudioPanel
              key={selected?.id ?? "empty"}
              job={selected}
              profiles={profiles}
              onGoPipeline={() => setTab("pipeline")}
              onStatus={(next) =>
                selected && store.setPipelineStatus(selected.id, next)
              }
              onNotes={(notes) => selected && store.updateJob(selected.id, { notes })}
              onDelete={() => {
                if (!selected) return;
                store.deleteJob(selected.id);
                setSelectedId(null);
                setTab("pipeline");
              }}
              canScoreWithClaude={doc.settings.anthropicApiKey.trim() !== ""}
              scoring={selected != null && scoringId === selected.id}
              scoreError={
                selected && scoreError?.id === selected.id ? scoreError.message : null
              }
              onScoreWithClaude={() => selected && void scoreWithClaude(selected)}
            />
          )}
        </FolderPanel>
      </div>

      {/* ═══ status line — a save failure is never swallowed ═══ */}
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-1.5 text-[10.5px] text-muted-foreground sm:px-6">
        <span className="inline-flex items-center gap-1.5">
          <Dot
            tone={status.error ? "red" : status.saving ? "amber" : "green"}
            pulse={status.saving}
          />
          {status.adapterLabel}
        </span>
        <span className="font-mono">
          {status.saving
            ? "saving…"
            : status.lastSavedAt
              ? `saved ${relTime(status.lastSavedAt)}`
              : "nothing saved yet"}
        </span>
        {status.error ? (
          <span className="min-w-0 flex-1 font-medium text-red-400">
            {status.error}
          </span>
        ) : (
          <span className="ml-auto hidden sm:block">
            No account, no server — everything stays in this browser.
          </span>
        )}
      </footer>

      {addOpen ? (
        <AddJobSheet
          prefill={prefill}
          profiles={profiles}
          onAdd={handleAdd}
          onOpenJob={openJob}
          onClose={() => {
            setAddOpen(false);
            setPrefill(null);
          }}
        />
      ) : null}

      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
      {howOpen ? <HowItWorksSheet onClose={() => setHowOpen(false)} /> : null}
      {onboardingOpen ? (
        <Onboarding onDone={() => setOnboardingOpen(false)} />
      ) : null}
    </div>
  );
}

/* ══════════════════════════════ PIPELINE ══════════════════════════════ */

function PipelinePanel({
  totalJobs,
  grouped,
  working,
  profiles,
  selectedId,
  view,
  onView,
  sub,
  onSub,
  query,
  onQuery,
  track,
  onTrack,
  minFit,
  onMinFit,
  sort,
  onSort,
  filtersActive,
  onClearFilters,
  onOpenJob,
  onStatus,
  onCapture,
  onLoadSample,
}: {
  totalJobs: number;
  grouped: Record<PipelineStatus, Job[]>;
  working: Job[];
  profiles: Profile[];
  selectedId: string | null;
  view: View;
  onView: (v: View) => void;
  sub: "working" | "ignored";
  onSub: (v: "working" | "ignored") => void;
  query: string;
  onQuery: (v: string) => void;
  track: string;
  onTrack: (v: string) => void;
  minFit: number;
  onMinFit: (v: number) => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
  filtersActive: boolean;
  onClearFilters: () => void;
  onOpenJob: (id: string) => void;
  onStatus: (id: string, status: PipelineStatus) => void;
  onCapture: () => void;
  onLoadSample: () => void;
}) {
  const renderCard = (job: Job) => (
    <JobCard
      key={job.id}
      job={job}
      profiles={profiles}
      active={job.id === selectedId}
      onOpen={() => onOpenJob(job.id)}
      onStatus={(next) => onStatus(job.id, next)}
    />
  );

  return (
    <div>
      <PanelHeader
        title="Pipeline"
        sub="Triage is everything captured and undecided — Promote what is worth an afternoon, Skip the rest. Applied is a step only you can take: nothing here can send anything for you. Ignored is kept, out of the way, and restorable."
        actions={
          sub === "working" ? <ViewToggle value={view} options={VIEWS} onChange={onView} /> : undefined
        }
      />

      <div className="mb-4 flex border-b border-border">
        <SubTabBtn
          active={sub === "working"}
          onClick={() => onSub("working")}
          count={working.length}
        >
          Working
        </SubTabBtn>
        <SubTabBtn
          active={sub === "ignored"}
          onClick={() => onSub("ignored")}
          count={grouped.ignored.length}
        >
          Ignored
        </SubTabBtn>
      </div>

      {/* ── filters ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search title, company, description, notes…"
          className={cx(INPUT, "w-full sm:w-64")}
        />

        <span className="hidden h-4 w-px bg-border sm:block" />

        <Chip on={track === "all"} onClick={() => onTrack("all")}>
          All tracks
        </Chip>
        {profiles.map((profile) => (
          <Chip
            key={profile.id}
            on={track === profile.id}
            title={profile.name}
            onClick={() => onTrack(track === profile.id ? "all" : profile.id)}
          >
            {profile.short}
          </Chip>
        ))}

        <span className="hidden h-4 w-px bg-border sm:block" />

        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          min fit
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minFit}
            onChange={(e) => onMinFit(Number(e.target.value))}
            className="h-1 w-24 accent-emerald-500"
          />
          <span className="w-5 font-mono text-[11px] text-foreground">{minFit}</span>
        </label>

        {filtersActive ? (
          <Button size="xs" variant="ghost" onClick={onClearFilters}>
            clear
          </Button>
        ) : null}

        <span className="ml-auto">
          <ViewToggle value={sort} options={SORTS} onChange={onSort} />
        </span>
      </div>

      {sub === "working" ? (
        totalJobs === 0 ? (
          <EmptyBoard onCapture={onCapture} onLoadSample={onLoadSample} />
        ) : working.length === 0 ? (
          <NoMatches
            filtersActive={filtersActive}
            onClear={onClearFilters}
            hasIgnored={grouped.ignored.length > 0}
            onShowIgnored={() => onSub("ignored")}
          />
        ) : view === "table" ? (
          <JobTable
            jobs={working}
            profiles={profiles}
            selectedId={selectedId}
            onOpen={onOpenJob}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
            {COLUMNS.map((column) => (
              <KanbanCol
                key={column.status}
                label={column.label}
                count={grouped[column.status].length}
                hint={column.hint}
              >
                {grouped[column.status].map(renderCard)}
              </KanbanCol>
            ))}
          </div>
        )
      ) : grouped.ignored.length === 0 ? (
        <div className="py-16 text-center text-[11.5px] text-muted-foreground">
          Nothing skipped. Anything you Skip lands here — kept, not deleted, and
          one click from going back into Triage.
        </div>
      ) : (
        <JobTable
          jobs={grouped.ignored}
          profiles={profiles}
          selectedId={selectedId}
          onOpen={onOpenJob}
        />
      )}
    </div>
  );
}

const VIEWS = ["kanban", "table"] as const;
const SORTS = ["fit", "newest"] as const;

/* ───────────────────────────── sub-surfaces ───────────────────────────── */

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((cell) => (
          <div key={cell} className="h-[86px] rounded-[10px] bg-muted/60" />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((column) => (
          <div
            key={column}
            className="rounded-[10px] border border-border bg-muted/30 p-3"
          >
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-[74px] rounded-lg bg-card" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyBoard({
  onCapture,
  onLoadSample,
}: {
  onCapture: () => void;
  onLoadSample: () => void;
}) {
  return (
    <div className="py-16 text-center">
      <div className="text-[14px] font-bold">The board is empty</div>
      <p className="mx-auto mt-1.5 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
        Jobs arrive by capture — the extension, the bookmarklet, or the add form.
        Load the sample pipeline if you would rather see a full board before
        committing to anything.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button size="md" variant="primary" onClick={onLoadSample}>
          Load sample data
        </Button>
        <Button size="md" onClick={onCapture}>
          Capture a job
        </Button>
      </div>
    </div>
  );
}

function NoMatches({
  filtersActive,
  onClear,
  hasIgnored,
  onShowIgnored,
}: {
  filtersActive: boolean;
  onClear: () => void;
  hasIgnored: boolean;
  onShowIgnored: () => void;
}) {
  return (
    <div className="py-16 text-center">
      <div className="text-[13px] font-semibold">
        {filtersActive ? "No jobs match these filters" : "Nothing in the working board"}
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        {filtersActive
          ? "Loosen the search, the track, or the minimum fit."
          : "Everything you have captured has been skipped."}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {filtersActive ? (
          <Button size="md" onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
        {hasIgnored ? (
          <Button size="md" variant="ghost" onClick={onShowIgnored}>
            Show ignored
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function JobTable({
  jobs,
  profiles,
  selectedId,
  onOpen,
}: {
  jobs: Job[];
  profiles: Profile[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-border">
      <table className="w-full min-w-[640px] text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="border-b border-border px-3 py-2 text-left font-semibold">
              Job
            </th>
            <th className="border-b border-border px-3 py-2 text-left font-semibold">
              Stage
            </th>
            <th className="border-b border-border px-3 py-2 text-left font-semibold">
              Fit
            </th>
            <th className="border-b border-border px-3 py-2 text-left font-semibold">
              Tracks
            </th>
            <th className="border-b border-border px-3 py-2 text-right font-semibold">
              Budget
            </th>
            <th className="border-b border-border px-3 py-2 text-right font-semibold">
              Age
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const tracks = matchedLabels(job.score, profiles);
            return (
              <tr
                key={job.id}
                onClick={() => onOpen(job.id)}
                className={cx(
                  "cursor-pointer transition-colors hover:bg-muted/30",
                  job.id === selectedId && "bg-muted/40",
                )}
              >
                <td className="border-b border-border px-3 py-2.5">
                  <div className="line-clamp-1 font-semibold">{job.title}</div>
                  <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                    {[job.company, job.source].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="border-b border-border px-3 py-2.5">
                  <ColorBadge tone={STATUS_TONE[job.pipelineStatus]}>
                    {job.pipelineStatus}
                  </ColorBadge>
                </td>
                <td className="border-b border-border px-3 py-2.5">
                  <ScoreChip score={job.score?.fitScore ?? null} />
                </td>
                <td className="border-b border-border px-3 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {tracks.length > 0 ? (
                      tracks.map((entry) => (
                        <ColorBadge key={entry.id} tone={entry.tone} title={entry.name}>
                          {entry.short}
                        </ColorBadge>
                      ))
                    ) : (
                      <span className="text-[10.5px] text-text-muted">—</span>
                    )}
                  </span>
                </td>
                <td className="border-b border-border px-3 py-2.5 text-right font-mono text-[11px] text-muted-foreground">
                  {job.budgetHint || "—"}
                </td>
                <td className="border-b border-border px-3 py-2.5 text-right font-mono text-[11px] text-muted-foreground">
                  {relAge(job.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
