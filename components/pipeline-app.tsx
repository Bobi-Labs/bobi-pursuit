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
import { clearHired, readHired, writeHired, type HiredRecord } from "@/lib/hired";
import {
  DesktopGate,
  readMobileBypass,
  writeMobileBypass,
} from "./desktop-gate";
import { Directory, type DirectoryEntry } from "./directory";
import { SearchesPanel } from "./searches-panel";
import { isSafeUrl, parkPendingSearch } from "@/lib/saved-searches";
import { HowItWorksPanel, HowItWorksSheet } from "./how-it-works";
import {
  ALERT_LABEL,
  JOB_SITES,
  JOB_SITE_CATEGORIES,
  JOB_SITE_CATEGORY_LABEL,
} from "@/lib/job-sites";
import {
  COST_LABEL,
  RESOURCES,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_LABEL,
} from "@/lib/resources";
import { JobCard } from "./job-card";
import { JobStudioPanel } from "./job-detail";
import { Onboarding } from "./onboarding";
import { OverviewPanel } from "./overview-panel";
import { SettingsSheet } from "./settings-sheet";
import { TOUR_STOPS, Tour, resetTourSeen, shouldShowTour } from "./tour";
import {
  FEEDBACK_URL,
  REPO_URL,
  STUDIO_LINKEDIN_URL,
  SIBLING_PRODUCT,
  STUDIO_LINKS_URL,
  STUDIO_URL,
} from "@/lib/app-config";
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

export type TabKey =
  | "overview"
  | "pipeline"
  | "studio"
  | "jobsites"
  | "searches"
  | "resources"
  | "howitworks";
type View = "kanban" | "table";
type SortKey = "fit" | "newest";
/**
 * Which sub-tab the pipeline is showing. "working" is the board; the other two
 * are closed piles you visit rather than work.
 */
type BoardSub = "working" | "declined" | "ignored";

/* Six tabs, and the order is the argument.
 *
 * The three on the left are your own data, in the order you touch it. The two
 * in the middle are where work comes FROM — they are the only part of this app
 * that is useful on day one with an empty board, which is exactly when a job
 * seeker has nothing to triage and no reason to come back. "How it works" stays
 * last because it is read once. */
const TABS: FolderTab<TabKey>[] = [
  { key: "overview", label: "Overview" },
  { key: "pipeline", label: "Pipeline" },
  { key: "studio", label: "Job Studio" },
  { key: "jobsites", label: "Job Sites" },
  { key: "searches", label: "Searches" },
  { key: "resources", label: "Resources" },
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
  jobsites: "/jobsites/",
  searches: "/searches/",
  resources: "/resources/",
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
  sub: BoardSub;
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

/**
 * The board, left to right. This array is the ONLY definition of what the
 * kanban shows, and `BOARD_SET` below derives from it.
 *
 * It used to be typed `Exclude<PipelineStatus, "ignored">`, which quietly meant
 * "everything that is not ignored" — so adding a status put it in the Working
 * count and the table view while giving it no column to render in. The compiler
 * had nothing to say about it, because an array is allowed to be short. Deriving
 * the set from the columns makes the two agree by construction.
 */
const COLUMNS: {
  status: PipelineStatus;
  label: string;
  hint: string;
  /** What puts a card here, and what moves it on. Shown only when empty. */
  gets: string;
  then: string;
}[] = [
  {
    status: "triage",
    label: "Triage",
    hint: "Everything new, undecided. Decide, don’t read.",
    gets: "Anything you capture lands here, already scored.",
    then: "Promote what is worth an afternoon, Skip the rest.",
  },
  {
    status: "promoted",
    label: "Promoted",
    hint: "The shortlist — worth an afternoon.",
    gets: "Promote a card from Triage.",
    then: "Apply in your own time, then Mark applied.",
  },
  {
    status: "applied",
    label: "Applied",
    hint: "Sent. Now it is their move.",
    gets: "Mark applied once you have actually sent it.",
    then: "Cards here show how long they have been waiting.",
  },
  {
    status: "interviewing",
    label: "Interviewing",
    hint: "Something is live.",
    gets: "Mark a company response on an applied card.",
    then: "Nothing moves on its own — this app cannot read your email.",
  },
];

/** Exactly the statuses with a column. Anything else is a closed pile. */
const BOARD_SET = new Set<PipelineStatus>(COLUMNS.map((c) => c.status));

const STATUS_TONE = {
  triage: "cyan",
  promoted: "green",
  applied: "blue",
  interviewing: "purple",
  declined: "rose",
  ignored: "muted",
} as const;

/** Query params the capture link owns. Scrubbed after use so a refresh is inert. */
const CAPTURE_PARAMS = ["add", "t", "u", "d", "b", "s", "c"];

/** The other handoff: the extension sending the search you are looking at. */
const SEARCH_PARAMS = ["savesearch", "u", "t", "s"];

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
  /* The congratulations banner, read from its own storage key.
     Effect, never render: static export, no localStorage at build time. */
  const [hired, setHired] = useState<HiredRecord | null>(null);
  const [offerClear, setOfferClear] = useState(false);
  useEffect(() => {
    setHired(readHired());
  }, []);
  const [howOpen, setHowOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  /* Someone who chose to use a phone anyway, on a previous visit.
     Starts false so the prerendered HTML is the gate — the honest default —
     and only a stored preference or a click turns it off. */
  const [bypassed, setBypassed] = useState(false);
  useEffect(() => {
    if (readMobileBypass()) setBypassed(true);
  }, []);
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

    /* The extension's second handoff: "save this search".
     *
     * Handled before capture because both use `u` and `t`, and a link is one
     * or the other — `savesearch=1` is the discriminator. Different origins
     * mean the extension cannot write to this app's storage, so it opens a URL
     * instead. Nothing is posted anywhere. */
    const search = new URLSearchParams(window.location.search);
    if (search.get("savesearch") === "1") {
      const url = search.get("u") ?? "";
      if (isSafeUrl(url)) {
        // Parked in storage rather than memory: the goTab below is a route
        // change, and neither component state nor the module-level session
        // reliably survives one. See parkPendingSearch.
        parkPendingSearch({
          url,
          label: (search.get("t") ?? "").slice(0, 120),
          site: search.get("s") ?? "",
        });
        goTab("searches");
      }
      session.onboardingSettled = true;
      const clean = new URL(window.location.href);
      for (const key of SEARCH_PARAMS) clean.searchParams.delete(key);
      window.history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
      return;
    }

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
      interviewing: [],
      declined: [],
      ignored: [],
    };
    for (const job of sorted) groups[job.pipelineStatus].push(job);
    return groups;
  }, [sorted]);

  // Derived from the columns, not from "everything except ignored" — see the
  // note on COLUMNS. A status with no column is not silently working.
  const working = useMemo(
    () => sorted.filter((job) => BOARD_SET.has(job.pipelineStatus)),
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
      // A closed pile has its own tab; everything with a column is "working".
      setSub(stage === "ignored" || stage === "declined" ? stage : "working");
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
    <>
      {/* ═══ narrow screens get the gate, not the app ═══
       *
       * Driven by a CSS breakpoint rather than a measured width, and that is the
       * point: this is a static export that prerenders in Node, so anything
       * measured in an effect would paint the full app for a frame before
       * replacing it — the worst version of this screen is the one that flashes
       * the thing it is about to take away.
       *
       * `md:hidden` / `hidden md:block` means the server-rendered HTML is
       * already correct at every width, with no hydration mismatch and no
       * flash. `bypassed` is the only JS in it, and only after a click.
       *
       * The app still MOUNTS underneath — hidden, not unmounted — so pressing
       * "Continue anyway" is instant and the board is exactly as it was. See
       * desktop-gate.tsx for why the gate positions itself `fixed`. */}
      <div className={bypassed ? "hidden" : "md:hidden"}>
        <DesktopGate
          onContinue={() => {
            writeMobileBypass();
            setBypassed(true);
          }}
        />
      </div>

      <div className={bypassed ? undefined : "hidden md:block"}>
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
            {/* Counts only. "No accounts · no server of ours" used to trail
                them, one line under a banner that already says LOCAL-FIRST —
                the same claim twice in the same glance, in the strip whose job
                is to tell you how much work is waiting. */}
            <div className="mt-1 text-[14px] text-muted-foreground">
              {doc.jobs.length} captured · {triageCount} to review ·{" "}
              {promotedCount} promoted
            </div>
            {/* Phones only, permanent, no dismiss button.
                A dismissible banner is a thing you close in the first second and
                then cannot find when the cramped screen actually confuses you.

                ⚠️ It warns rather than reassures, and the difference matters.
                The first draft said a phone was "great for checking in", which
                is false: there is no sync, so this board is not the one on the
                desktop — it is a separate, empty board that happens to look the
                same. Somebody triaging jobs here on a commute would lose the
                afternoon's work to that misunderstanding. */}
            <div className="mt-1.5 text-[13px] text-amber-300/90 sm:hidden">
              Built for desktop. This board saves in this phone’s browser only —
              it will not appear on your computer.
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

      {/* ═══ you got the job ═══
          Above everything, because on the day it is true it is the only thing
          on this screen that matters. It survives clearing the board on
          purpose — that is the whole flow: celebrate, wipe the pipeline, and
          the banner is still there afterwards explaining why it is empty. */}
      {hired ? (
        <div className="border-b border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-emerald-300">
                🎉 Congratulations on your new role
                {hired.company ? ` at ${hired.company}` : ""}
              </div>
              <div className="mt-0.5 truncate text-[14px] text-emerald-200/70">
                {hired.title}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {offerClear ? (
                <>
                  <span className="text-[14px] text-emerald-200/80">
                    Clear the board and start fresh?
                  </span>
                  <Button
                    size="md"
                    variant="solid"
                    onClick={() => {
                      setOfferClear(false);
                      handleWipe();
                      store.clearAll();
                    }}
                  >
                    Clear the board
                  </Button>
                  <Button size="md" onClick={() => setOfferClear(false)}>
                    Keep it
                  </Button>
                </>
              ) : (
                <Button
                  size="md"
                  onClick={() => {
                    clearHired();
                    setHired(null);
                  }}
                >
                  Dismiss
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ═══ who made this ═══
          Placed between the banner and the tabs, in the empty run of space the
          operator pointed at, and deliberately quiet: small type, muted colour,
          no button styling. It is the only outbound set in the app that is not
          about the reader's own job hunt, and a job seeker opening this at
          11pm should not be sold to. Each link is null-checked so a fork can
          empty them rather than ship dead controls. */}
      {(STUDIO_LINKS_URL || REPO_URL || STUDIO_LINKEDIN_URL) && (
        <div className="border-b border-border px-4 py-2 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-text-muted">
            {STUDIO_LINKS_URL && (
              <>
                <span>Want something custom built?</span>
                <a
                  href={STUDIO_LINKS_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  Work with us ↗
                </a>
              </>
            )}

            {/* The middle of the row, which was empty. Same register as the
                rest of this bar — small, muted, no button — because it is a
                suggestion from one free tool to another, not a placement. */}
            {SIBLING_PRODUCT && (
              <a
                href={SIBLING_PRODUCT.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mx-auto inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              >
                <span aria-hidden>◧</span>
                Also free:{" "}
                <span className="font-semibold text-muted-foreground">
                  {SIBLING_PRODUCT.name}
                </span>
                <span className="hidden sm:inline">
                  {" — "}
                  {SIBLING_PRODUCT.blurb} ↗
                </span>
              </a>
            )}

            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {STUDIO_URL && (
                <a
                  href={STUDIO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="transition-colors hover:text-foreground"
                >
                  Powered by Bobi Labs
                </a>
              )}
              {REPO_URL && (
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Source on GitHub — this app is MIT licensed"
                  className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                >
                  <GitHubMark />
                  GitHub
                </a>
              )}
              {STUDIO_LINKEDIN_URL && (
                <a
                  href={STUDIO_LINKEDIN_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Bobi Labs on LinkedIn"
                  className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                >
                  <LinkedInMark />
                  LinkedIn
                </a>
              )}
            </span>
          </div>
        </div>
      )}

      {/* ═══ folder tabs + panel ═══ */}
      <div className="flex-1 px-4 pb-12 pt-3 sm:px-6">
        <FolderTabs
          tabs={TABS}
          active={tab}
          counts={{ pipeline: working.length }}
          onChange={goTab}
        />
        <FolderPanel className="min-h-[680px]">
          {tab === "jobsites" ? (
            // Ahead of the `loaded` gate for the same reason as How it works:
            // these read no document state, so waiting on storage would be a
            // spinner for nothing. It also means the two tabs that work on an
            // empty board render instantly on a cold visit.
            <Directory
              title="Job Sites"
              sub="Every job posting site we know of. Missing one you use? Tell us."
              entries={JOB_SITE_ENTRIES}
              categories={JOB_SITE_CATEGORIES}
              categoryLabel={JOB_SITE_CATEGORY_LABEL}
              storageKey="pursuit.fav.jobsites"
              searchPlaceholder="Search sites, or try “RSS”, “ghost jobs”…"
            />
          ) : tab === "searches" ? (
            <SearchesPanel onGoJobSites={() => goTab("jobsites")} />
          ) : tab === "resources" ? (
            <Directory
              title="Resources"
              sub="CV help, cover letters, interview practice, pay research and your rights. Free or paid is marked on every one."
              entries={RESOURCE_ENTRIES}
              categories={RESOURCE_CATEGORIES}
              categoryLabel={RESOURCE_CATEGORY_LABEL}
              storageKey="pursuit.fav.resources"
              searchPlaceholder="Search resources, or try “free”, “UK”…"
            />
          ) : tab === "howitworks" ? (
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
              onHired={() => {
                if (!selected) return;
                writeHired({
                  title: selected.title,
                  company: selected.company,
                  at: new Date().toISOString(),
                });
                setHired(readHired());
                setOfferClear(true);
              }}
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
          onReplayTour={() => {
            setSettingsOpen(false);
            // Clear the latch FIRST: startTour() early-returns when the tour has
            // been seen, which is true of everyone who would want to replay it.
            resetTourSeen();
            startTour();
          }}
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
      </div>
    </>
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
  sub: BoardSub;
  onSub: (v: BoardSub) => void;
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

  // Whichever closed pile the sub-tab is showing. Both render through the same
  // JobTable, and both are already filtered by the search box and track chips —
  // `grouped` derives from `sorted` from `filtered`, so the archive is
  // searchable on day one without a line of new code.
  const closed = sub === "declined" ? grouped.declined : grouped.ignored;

  return (
    <div>
      <PanelHeader
        title="Pipeline"
        // What each column is for is written inside the column, on the empty
        // placeholder, where you are looking when you need it. Saying it a
        // second time up here in one long sentence was the version nobody read.
        sub="Your pipeline — move the jobs you capture through the process here."
        actions={
          sub === "working" ? <ViewToggle value={view} options={VIEWS} onChange={onView} /> : undefined
        }
      />

      {/* Two closed piles, and they are not the same thing.
          Declined is THEIR decision, after you applied. Ignored is YOUR
          decision, before you did. Keeping them apart is what makes the archive
          answer "have I already been turned down here?" rather than just
          "have I seen this before?". Both live behind a tab rather than as
          board columns, because a column of finished work crowds the live ones
          and neither needs deciding again. */}
      <div className="mb-4 flex border-b border-border">
        <SubTabBtn
          active={sub === "working"}
          onClick={() => onSub("working")}
          count={working.length}
        >
          Working
        </SubTabBtn>
        <SubTabBtn
          active={sub === "declined"}
          onClick={() => onSub("declined")}
          count={grouped.declined.length}
        >
          Declined
        </SubTabBtn>
        <SubTabBtn
          active={sub === "ignored"}
          onClick={() => onSub("ignored")}
          count={grouped.ignored.length}
        >
          Skipped
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

        <span className="hidden h-4 w-px bg-border sm:block" />

        {/* Sort sat behind `ml-auto`, alone at the far right of the row while
            every other control was grouped left. The operator did not find it
            for weeks — a control pushed away from its peers reads as decoration,
            not as something you can press. It sits with the filters now. */}
        <ViewToggle value={sort} options={SORTS} onChange={onSort} />

        {filtersActive ? (
          <Button size="xs" variant="ghost" onClick={onClearFilters}>
            clear
          </Button>
        ) : null}
      </div>

      {sub === "working" ? (
        totalJobs === 0 ? (
          /* An empty board still shows its columns.
           *
           * It used to render one centred call to action and nothing else,
           * which meant the four columns did not exist in the single state
           * every new user is in — and the tour's three board stops had
           * nothing to ring and nothing to explain. The operator hit exactly
           * that: step 3 of 9, on a blank page, being told about four columns
           * he could not see.
           *
           * Now the prompt sits above the real board, every column carries its
           * placeholder saying what it is for, and the tour has something to
           * point at. It is also the answer to the original request — a worked
           * example in every column — without seeding fake cards that would
           * score, count and need deleting. */
          <>
            <EmptyBoard onCapture={onCapture} onLoadSample={onLoadSample} />
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1fr]">
              {COLUMNS.map((column) => (
                <KanbanCol
                  key={column.status}
                  label={column.label}
                  count={0}
                  hint={column.hint}
                  emptyGets={column.gets}
                  emptyThen={column.then}
                  anchor={`col-${column.status}`}
                >
                  {null}
                </KanbanCol>
              ))}
            </div>
          </>
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
          /* Four across only at xl. A 1024px laptop gets two comfortable columns
             rather than four cramped ones, and Triage stays widest because it is
             the only column you actually read in. */
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1fr]">
            {COLUMNS.map((column) => (
              <KanbanCol
                key={column.status}
                label={column.label}
                count={grouped[column.status].length}
                hint={column.hint}
                emptyGets={column.gets}
                emptyThen={column.then}
                anchor={`col-${column.status}`}
              >
                {grouped[column.status].map(renderCard)}
              </KanbanCol>
            ))}
          </div>
        )
      ) : closed.length === 0 ? (
        <div className="py-16 text-center text-[14px] text-muted-foreground">
          {sub === "declined"
            ? "Nothing declined yet. When a company says no, mark it here — it stays searchable so you know you have already been through them."
            : "Nothing skipped. Anything you Skip lands here — kept, not deleted, and one click from going back into Triage."}
        </div>
      ) : (
        <JobTable
          jobs={closed}
          profiles={profiles}
          selectedId={selectedId}
          onOpen={onOpenJob}
        />
      )}
    </div>
  );
}

/* Both directories, mapped to the component's shape once at module level.
 *
 * Deliberately not inside the render: these lists are static, and rebuilding
 * 105 objects on every keystroke in the search box would be work done for
 * nothing. The badge is the field each list actually wants surfaced — whether a
 * job site can alert you, and what a resource costs. */
const JOB_SITE_ENTRIES: DirectoryEntry[] = JOB_SITES.map((site) => ({
  ...site,
  badge: ALERT_LABEL[site.alerts],
  badgeTone:
    site.alerts === "both" ? "green" : site.alerts === "none" ? "muted" : "blue",
}));

const RESOURCE_ENTRIES: DirectoryEntry[] = RESOURCES.map((resource) => ({
  ...resource,
  badge: COST_LABEL[resource.cost],
  badgeTone:
    resource.cost === "free"
      ? "green"
      : resource.cost === "freemium"
        ? "amber"
        : "muted",
}));

const VIEWS = ["kanban", "table"] as const;
const SORTS = ["fit", "newest"] as const;

/* ───────────────────────────── sub-surfaces ───────────────────────────── */

/* Inline SVG rather than an icon package or a remote image.
 *
 * The app ships as a static export with a strict CSP and no external requests,
 * so a CDN icon would simply not load; and pulling a whole icon library in for
 * two glyphs would cost more bytes than the rest of this component. Both are
 * `currentColor` so they inherit the link's hover state for free. */
function GitHubMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-current"
      focusable="false"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function LinkedInMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-current"
      focusable="false"
    >
      <path d="M3.6 5.5H.9V15h2.7V5.5ZM2.25 1a1.56 1.56 0 1 0 0 3.12 1.56 1.56 0 0 0 0-3.12ZM15.1 9.7c0-2.6-1.39-3.81-3.24-3.81-1.5 0-2.17.82-2.54 1.4V5.5H6.62c.04.76 0 9.5 0 9.5h2.7V9.69c0-.24.02-.48.09-.65.19-.48.63-.98 1.36-.98.96 0 1.35.73 1.35 1.8V15h2.7V9.7Z" />
    </svg>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-40 rounded bg-muted" />
      {/* Cell and column counts match the real grids above. A skeleton that
          shows four boxes and then paints five is a layout jump on every cold
          load — small, but it is the first thing the app does. */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((cell) => (
          <div key={cell} className="h-[86px] rounded-[10px] bg-muted/60" />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((column) => (
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
    // Compact now that the columns render beneath it: this was a full-page
    // empty state and is a prompt sitting on top of a real board.
    <div className="py-6 text-center">
      <div className="text-[14px] font-bold">The board is empty</div>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
        Capture a job with the plugin and it lands here, scored.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
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
