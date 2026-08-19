"use client";

/**
 * The studio shell — header, folder tabs, four panels, status line.
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
 *
 * Each tab is also a real URL — see `TAB_PATH`. Four route folders under `app/`
 * become four real HTML files at build time, so a reload of `/pipeline/` lands
 * on the board instead of bouncing to Overview, and a link to it is a link that
 * works. Switching tabs is a client-side `router.push`, which leaves the store
 * singleton (module-level, see `lib/store/store.ts`) exactly where it was: no
 * refetch, no reparse of localStorage, no flicker.
 *
 * Two movers, and the difference is whose idea the move was. `goTab` is a click
 * you made, so it pushes. `showTab` is the first-run tour walking you across
 * four tabs on its own initiative, so it replaces — four history entries nobody
 * asked for, sitting between the user and wherever they came from, is a worse
 * bug than the one the tour is there to prevent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { parseCaptureParams, type CaptureParams } from "@/lib/capture";
import { matchedLabels } from "@/lib/profile-view";
import { scoreJobWithClaude } from "@/lib/scoring/llm-scorer";
import { store } from "@/lib/store/store";
import { usePipeline, useStoreStatus } from "@/lib/store/use-pipeline";
import { STARTER_PROFILE_ID, type Job, type PipelineStatus, type Profile } from "@/lib/types";

import { AddJobSheet, type AddResult, type NewJobInput } from "./add-job-sheet";
import { HowItWorksPanel, HowItWorksSheet } from "./how-it-works";
import { JobCard } from "./job-card";
import { JobStudioPanel } from "./job-detail";
import { Onboarding } from "./onboarding";
import { OverviewPanel } from "./overview-panel";
import { SettingsSheet } from "./settings-sheet";
import { TOUR_STOPS, Tour, resetTourSeen, shouldShowTour } from "./tour";
import { FEEDBACK_URL } from "@/lib/app-config";
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

export type TabKey = "overview" | "pipeline" | "studio" | "howitworks";
type View = "kanban" | "table";
type SortKey = "fit" | "newest";
type BoardStatus = Exclude<PipelineStatus, "ignored">;

const TABS: FolderTab<TabKey>[] = [
  { key: "overview", label: "Overview" },
  { key: "pipeline", label: "Pipeline" },
  { key: "studio", label: "Job Studio" },
  { key: "howitworks", label: "How it works" },
];

/**
 * Tab → URL. One row per tab, and the only place a route string is written.
 *
 * Trailing slashes are deliberate: `next.config.mjs` sets `trailingSlash: true`,
 * so the export writes `out/pipeline/index.html`, and `/pipeline/` is the form
 * that resolves on a bare static host with nothing in front of it to redirect.
 * `studio` lives at `/jobstudio/` because that is the address that was asked
 * for; the tab key stays `studio` so nothing else in this file has to change.
 */
const TAB_PATH: Record<TabKey, string> = {
  overview: "/",
  pipeline: "/pipeline/",
  studio: "/jobstudio/",
  howitworks: "/howitworks/",
};

/** `"/pipeline/"` and `"/pipeline"` are the same route; `"/"` stays `"/"`. */
function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

const PATH_TAB = new Map<string, TabKey>(
  (Object.keys(TAB_PATH) as TabKey[]).map((key) => [
    normalizePath(TAB_PATH[key]),
    key,
  ]),
);

/* ── view state that outlives a route change ────────────────────────────────
 *
 * Now that every tab is its own route, the App Router mounts a *fresh* shell for
 * each one — same component, different segment, so React drops the old tree and
 * every `useState` below goes back to its initial value. The document does not
 * notice, because the store is a module-level singleton; this object exists so
 * that the handful of view fields which would otherwise break something do not
 * notice either. Verified in a browser, not assumed: without it, clicking a job
 * card navigated to a Job Studio that said "No job open", and the first-run
 * wizard reopened on every tab click.
 *
 * `selectedId` is the one that is not optional — opening a card sets it and then
 * navigates to `/jobstudio/`. The filters are here because coming back from
 * Overview to a board you had narrowed, wide open again, reads as the app losing
 * your place.
 *
 * Deliberately NOT here: which sheet is open (a dialog that reopens itself after
 * a navigation is a bug, not a courtesy), and the in-flight scoring state — its
 * `AbortController` dies with the tree, so a restored spinner would be spinning
 * for a request nobody is waiting on.
 *
 * Module scope rather than `sessionStorage`, because this is read during render
 * and `output: 'export'` renders in Node at build time, where no browser storage
 * exists. Nothing mutates it during render, so all four pages prerender from
 * these defaults and hydration agrees.
 */
interface ViewSession {
  selectedId: string | null;
  view: View;
  sub: "working" | "ignored";
  query: string;
  track: string;
  minFit: number;
  sort: SortKey;
  /**
   * Latched the first time storage answers, and never re-asked — except by a
   * deliberate wipe, which re-arms it. See `handleWipe`.
   */
  onboardingSettled: boolean;
  /**
   * The tour, both fields, for the reason this object exists at all: the tour
   * now walks you across four tabs, every one of those is a route change, and a
   * route change remounts this shell. Held here, the tour survives its own
   * navigation. Held in `useState`, it would be wiped by its own second step and
   * restart at stop one forever.
   */
  tourOpen: boolean;
  tourStep: number;
}

const session: ViewSession = {
  selectedId: null,
  view: "kanban",
  sub: "working",
  query: "",
  track: "all",
  minFit: 0,
  sort: "fit",
  onboardingSettled: false,
  tourOpen: false,
  tourStep: 0,
};

/** `useState`, except the value survives the remount a route change causes. */
function useSessionState<K extends keyof ViewSession>(
  key: K,
): [ViewSession[K], (next: ViewSession[K]) => void] {
  const [value, setValue] = useState<ViewSession[K]>(session[key]);
  const set = useCallback(
    (next: ViewSession[K]) => {
      session[key] = next;
      setValue(next);
    },
    [key],
  );
  return [value, set];
}

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

export default function PipelineApp({
  /**
   * Which tab this route opens on. Supplied by the four page files under `app/`,
   * so a cold load of `/pipeline/` renders the board in its first frame rather
   * than painting Overview and then correcting itself.
   */
  initialTab = "overview",
}: {
  initialTab?: TabKey;
}) {
  const doc = usePipeline();
  const status = useStoreStatus();
  const profiles = doc.settings.profiles;
  const router = useRouter();
  const pathname = usePathname();

  /**
   * The tab is held locally *and* derived from the URL, and the two disagree for
   * exactly one moment: between a click and the router committing the push.
   * Local state is what makes the click feel instant; the URL is the authority,
   * because Back and Forward change it without ever running a click handler.
   */
  const [tab, setTab] = useState<TabKey>(initialTab);
  const routeTab = PATH_TAB.get(normalizePath(pathname)) ?? initialTab;
  useEffect(() => {
    // Setting the value it already holds bails out inside React, so the common
    // case (this effect running right after our own push lands) costs nothing.
    setTab(routeTab);
  }, [routeTab]);

  /** Switch tab now, change the address after. Never the other way round. */
  const goTab = useCallback(
    (next: TabKey) => {
      setTab(next);
      router.push(TAB_PATH[next]);
    },
    [router],
  );

  /**
   * The tour's version: change the panel, leave the address bar alone.
   *
   * ⚠️ This deliberately does NOT route, and that is load-bearing rather than a
   * simplification. It used to call `router.replace`, and under `output: 'export'`
   * that is a full document load, not a client-side transition — the RSC payload
   * a soft navigation needs is not there to fetch, so the router falls back to
   * hard navigation. A full load re-evaluates this module, which resets
   * `session` to its initial literal, which un-latches `onboardingSettled`,
   * which re-runs the first-run effect, which calls `startTour()` again at step
   * 0, which navigates to stop 1's tab, which loads the document again. The tour
   * ran 1, 2, 1, 2 forever and never reached stop 3.
   *
   * The tour's job is to put the right SCREEN behind the card. It was never to
   * demonstrate URLs, so swapping the panel in place satisfies it completely and
   * removes a whole class of state-loss bug with it. Tab clicks still route; see
   * `goTab`.
   */
  const showTab = useCallback((next: TabKey) => {
    setTab(next);
  }, []);

  /* Everything down to `sort` outlives a route change — see `ViewSession`. */
  const [selectedId, setSelectedId] = useSessionState("selectedId");
  const [view, setView] = useSessionState("view");
  const [sub, setSub] = useSessionState("sub");
  const [query, setQuery] = useSessionState("query");
  const [track, setTrack] = useSessionState("track");
  const [minFit, setMinFit] = useSessionState("minFit");
  const [sort, setSort] = useSessionState("sort");
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<CaptureParams | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* Whether Settings was opened to add a key, rather than to browse settings.
     Reset on close so the next ordinary visit starts at the top. */
  const [settingsFocusKey, setSettingsFocusKey] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [tourOpen, setTourOpen] = useSessionState("tourOpen");
  const [tourStep, setTourStep] = useSessionState("tourStep");
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
    session.onboardingSettled = true;

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

  const openJob = useCallback(
    (id: string) => {
      setSelectedId(id);
      goTab("studio");
    },
    [goTab],
  );

  const goPipeline = useCallback(
    (stage?: PipelineStatus) => {
      goTab("pipeline");
      setSub(stage === "ignored" ? "ignored" : "working");
    },
    [goTab],
  );

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

  /* ── the tour ─────────────────────────────────────────────────────────── */

  /**
   * Open the tour at stop one, if this browser has never seen it.
   *
   * The `shouldShowTour()` check lives here rather than at each call site so the
   * two entry points below cannot disagree about it, and so a third one added
   * later inherits it. It reads `localStorage`, so both callers are effects or
   * click handlers, never render.
   */
  const startTour = useCallback(() => {
    if (!shouldShowTour()) return;
    setTourStep(0);
    setTourOpen(true);
  }, [setTourStep, setTourOpen]);

  /**
   * The tour drives the address bar.
   *
   * Each stop names the tab it is about and this puts that tab on screen behind
   * the card. Without it the tour is five boxes read over one unchanging page,
   * which is what the operator called useless, and fairly: a stop about the
   * Pipeline that never shows you the Pipeline is a paragraph, not a tour.
   *
   * No loop risk: `showTab` sets `tab` synchronously, so the next run of this
   * effect finds them equal and does nothing.
   */
  useEffect(() => {
    if (!tourOpen) return;
    const wanted = TOUR_STOPS[Math.min(tourStep, TOUR_STOPS.length - 1)].tab;
    if (wanted !== tab) showTab(wanted);
  }, [tourOpen, tourStep, tab, showTab]);

  /**
   * ⚠️ The one place that knows "onboarding closed, so show the tour".
   *
   * Onboarding has three doors and every one of them now closes through this
   * single prop (see the header of `onboarding.tsx`). Chaining the tour off
   * "finished" alone was the shape that broke: the two doors a sceptical first
   * run is most likely to take, "Skip setup" and the sample-data escape, are
   * exactly the ones that would have missed it. Keeping the decision here rather
   * than at each exit is what stops the next door from missing it too.
   *
   * Chained, not concurrent: both are z-50 overlays and a fresh browser
   * satisfies the trigger for each, so opening them independently would stack
   * them.
   */
  const closeOnboarding = useCallback(() => {
    setOnboardingOpen(false);
    startTour();
  }, [startTour]);

  /**
   * "Delete everything" in Settings means everything, including the two flags
   * that make a first visit a first visit.
   *
   * This is the bug behind "I cleared the data and the tour was gone". The wipe
   * empties the document, but the first-run latch is module state that no wipe
   * touches and the tour-seen flag is a separate `localStorage` key that no wipe
   * touches, so the app came back convinced you had already been here: no setup,
   * no tour, and an empty board with no explanation. It was never reachable from
   * inside onboarding, because onboarding never opened.
   *
   * Re-arming the latch lets the first-run effect fire again on the now-empty
   * document, which reopens setup, which hands over to the tour. Settings closes
   * with it, because the wizard is about to cover the screen and a settings
   * panel left open underneath is two modals deep.
   */
  const handleWipe = useCallback(() => {
    setSettingsOpen(false);
    resetTourSeen();
    session.onboardingSettled = false;
  }, []);

  /**
   * First run: a loaded, empty document still carrying the shipped starter
   * track. Decided **once**, the moment storage answers, and never again.
   *
   * The obvious version — deriving "is this a fresh document?" on every render —
   * unmounts itself halfway through: step 1 commits the user's tracks, the
   * document stops looking fresh, and the wizard vanishes mid-sentence. The
   * latch is what makes the flow survive its own first side effect, and it lives
   * in `session` rather than a ref because a route change throws refs away too —
   * a user who skipped setup got the wizard back on their next tab click.
   */
  useEffect(() => {
    if (session.onboardingSettled || !status.loaded) return;
    session.onboardingSettled = true;
    const firstRun =
      doc.jobs.length === 0 &&
      profiles.length === 1 &&
      profiles[0].id === STARTER_PROFILE_ID;
    if (firstRun) {
      setOnboardingOpen(true);
      return; // every exit from onboarding hands over — see `closeOnboarding`
    }
    // Everyone else: anyone already holding a board never opens onboarding, so
    // without this they would never see the tour at all. That is most existing
    // users, and it was the first thing the operator hit after the tour shipped.
    startTour();
  }, [status.loaded, doc.jobs.length, profiles, startTour]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* ═══ banner ═══ */}
      <header className="relative overflow-hidden border-b border-border px-4 pb-4 pt-5 sm:px-6">
        <div aria-hidden className="banner-mesh absolute inset-0" />
        <div aria-hidden className="banner-grid absolute inset-0 opacity-50" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
              Bobi Labs · local-first
            </div>
            <h1 className="text-2xl font-bold -tracking-[0.02em]">
              Bobi<span className="text-emerald-400">·</span>Pursuit
            </h1>
            <div className="mt-1 text-[14px] text-muted-foreground">
              {doc.jobs.length} captured · {triageCount} to review ·{" "}
              {promotedCount} promoted · no accounts · no server of ours
            </div>
          </div>
          <div className="relative flex flex-wrap items-center gap-1.5">
            <Button
              size="md"
              variant="primary"
              data-tour="capture"
              onClick={() => setAddOpen(true)}
            >
              + Capture a job
            </Button>
            <Button size="md" onClick={() => setHowOpen(true)}>
              How it works
            </Button>
            <Button size="md" onClick={() => setSettingsOpen(true)}>
              Settings
            </Button>
            {/* A link, not a POST: this app has no server and its CSP would
                refuse the request anyway. Renders only once the intake page
                exists, so we never ship a button that 404s. */}
            {FEEDBACK_URL && (
              <a
                href={FEEDBACK_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-[14px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                Feedback
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ═══ folder tabs + panel ═══ */}
      <div className="flex-1 px-4 pb-12 pt-3 sm:px-6">
        <FolderTabs
          tabs={TABS}
          active={tab}
          counts={{ pipeline: working.length }}
          onChange={goTab}
        />
        <FolderPanel className="min-h-[680px]">
          {tab === "howitworks" ? (
            // Ahead of the `loaded` gate on purpose: this tab reads no document
            // state, and the skeleton exists to stop an empty board flashing in
            // front of someone who has two hundred jobs. There is no board here
            // to flash, so waiting on storage would be a spinner for nothing.
            <HowItWorksPanel />
          ) : !status.loaded ? (
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
              onGoPipeline={() => goTab("pipeline")}
              onAddKey={() => {
                setSettingsFocusKey(true);
                setSettingsOpen(true);
              }}
              onStatus={(next) =>
                selected && store.setPipelineStatus(selected.id, next)
              }
              onNotes={(notes) => selected && store.updateJob(selected.id, { notes })}
              onDelete={() => {
                if (!selected) return;
                store.deleteJob(selected.id);
                setSelectedId(null);
                goTab("pipeline");
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
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-1.5 text-[12px] text-muted-foreground sm:px-6">
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
          <span className="min-w-0 flex-1 text-[14px] font-medium text-red-400">
            {status.error}
          </span>
        ) : (
          <span className="ml-auto hidden text-[14px] sm:block">
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

      {settingsOpen ? (
        <SettingsSheet
          onClose={() => {
            setSettingsOpen(false);
            setSettingsFocusKey(false);
          }}
          onWipe={handleWipe}
          focusKey={settingsFocusKey}
        />
      ) : null}
      {howOpen ? <HowItWorksSheet onClose={() => setHowOpen(false)} /> : null}
      {onboardingOpen ? <Onboarding onClose={closeOnboarding} /> : null}

      {/* Opened from two places, both of them `startTour`: chained off any exit
          from onboarding for a first run, and from the first-run effect above
          for everyone who already has a board. `open` and `step` are held in
          `session` because each stop navigates and each navigation remounts this
          shell; `shouldShowTour` is only ever read inside an effect, because
          this is a static export that still prerenders and localStorage is
          absent there. */}
      <Tour
        open={tourOpen}
        step={tourStep}
        onStep={setTourStep}
        onClose={() => setTourOpen(false)}
      />
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
          // Shortened when the input went 12px -> 14px: the old
          // "Search title, company, description, notes…" clipped mid-word.
          placeholder="Search jobs…"
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

        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
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
          <span className="w-6 font-mono text-[12px] text-foreground">{minFit}</span>
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
        <div className="py-16 text-center text-[14px] text-muted-foreground">
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
      <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
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
      <div className="text-[14px] font-semibold">
        {filtersActive ? "No jobs match these filters" : "Nothing in the working board"}
      </div>
      <p className="mt-1.5 text-[14px] text-muted-foreground">
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
      <table className="w-full min-w-[640px] text-[14px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
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
                  <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
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
                      <span className="text-[12px] text-text-muted">—</span>
                    )}
                  </span>
                </td>
                <td className="border-b border-border px-3 py-2.5 text-right font-mono text-[12px] text-muted-foreground">
                  {job.budgetHint || "—"}
                </td>
                <td className="border-b border-border px-3 py-2.5 text-right font-mono text-[12px] text-muted-foreground">
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
