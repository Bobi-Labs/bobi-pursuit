/**
 * The pipeline store.
 *
 * One in-memory `PursuitDoc`, synchronous mutations, and a 400 ms debounced
 * whole-document write through a `StorageAdapter`. This replaces an entire
 * networked data layer — server cache, query registries, optimistic updates,
 * staleness workarounds. There is no network, so there is no loading state to
 * model, no cache to invalidate, and nothing to roll back: the write already
 * happened, in memory, before the function returned.
 *
 * Four rules the rest of this file exists to enforce:
 *
 * 1. **Nothing touches `window` or `localStorage` during render.**
 *    `output: 'export'` does not mean "no server render" — it means the render
 *    happens on the author's machine at build time, in Node. `getServerSnapshot()`
 *    returns a frozen, deterministic, empty document; the real one arrives from
 *    `init()` inside an effect.
 * 2. **Mutations cannot fail.** They mutate memory and return, or return the
 *    entity they created. *Saving* can fail — that surfaces in
 *    `getStatus().error` and is **never swallowed**. `QuotaExceededError` is a
 *    real thing that happens to real users.
 * 3. **Reference identity is the change signal.** `useSyncExternalStore`
 *    compares snapshots by identity, so every effective mutation produces a new
 *    top-level document object — and a *no-op* must return the same one, or
 *    React re-renders forever.
 * 4. **A job never sits unscored.** Anything that enters the document —
 *    captured, imported, sampled — is scored on the way in.
 */

import { normalizeUrl } from "@/lib/capture";
import { newId } from "@/lib/id";
import {
  reconcileScoreToProfiles,
  scoreJobWithRules,
} from "@/lib/scoring/rule-scorer";
import { sampleJobs } from "@/lib/seed/sample-jobs";
import {
  DOC_KIND,
  LEGACY_PROFILE_IDS,
  MAX_PROFILES,
  MIN_PROFILES,
  PROFILE_PRESETS,
  SCHEMA_VERSION,
  defaultSettings,
  emptyDoc,
  findPreset,
  isColorTone,
  isPipelineStatus,
  nextTone,
  type ColorTone,
  type Job,
  type JobScore,
  type PipelineStatus,
  type Profile,
  type ProfileScore,
  type ProfileScores,
  type PursuitDoc,
  type PursuitSettings,
} from "@/lib/types";
import {
  createFileSystemAdapter,
  isFileSystemAccessSupported,
} from "./adapters/file-system";
import { LocalStorageAdapter } from "./adapters/local-storage";
import { MemoryAdapter } from "./adapters/memory";
import { StoreError, type StorageAdapter } from "./adapters/types";

export const SAVE_DEBOUNCE_MS = 400;

/**
 * The prerender document.
 *
 * Frozen (so nothing can mutate it into a real document by accident) and
 * timestamped with the epoch rather than `Date.now()` — a build-time timestamp
 * baked into `out/index.html` would not match the client's, and that is a
 * hydration mismatch waiting for the first component that renders a date.
 */
const EPOCH = "1970-01-01T00:00:00.000Z";

const EMPTY_DOC: PursuitDoc = deepFreeze({
  kind: DOC_KIND,
  schemaVersion: SCHEMA_VERSION,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  settings: defaultSettings(),
  jobs: [] as Job[],
});

/* ─────────────────────────────── Status ─────────────────────────────── */

export interface StoreStatus {
  /** `"local"`, `"memory"`, `"local+fsa"`. */
  adapterId: string;
  /** Rendered verbatim: "This browser", "This browser + pipeline.pursuit.json". */
  adapterLabel: string;
  saving: boolean;
  /** The last load or save failure, already phrased for a human. Render it. */
  error: string | null;
  lastSavedAt: string | null;
  /** `false` until `init()` has read storage. Gate empty-states on this. */
  loaded: boolean;
}

const INITIAL_STATUS: StoreStatus = Object.freeze({
  // Optimistic on purpose: this is the state the prerendered HTML is built with
  // and the state the client hydrates with, so they must agree, and "this
  // browser has localStorage" is right for all but a rounding error of users.
  // `init()` corrects it within a frame if it is wrong.
  adapterId: "local",
  adapterLabel: "This browser",
  saving: false,
  error: null,
  lastSavedAt: null,
  loaded: false,
});

function sameStatus(a: StoreStatus, b: StoreStatus): boolean {
  return (
    a.adapterId === b.adapterId &&
    a.adapterLabel === b.adapterLabel &&
    a.saving === b.saving &&
    a.error === b.error &&
    a.lastSavedAt === b.lastSavedAt &&
    a.loaded === b.loaded
  );
}

/* ─────────────────────────────── Helpers ─────────────────────────────── */

function now(): string {
  return new Date().toISOString();
}

function deepFreeze<T>(value: T): T {
  if (value && (typeof value === "object" || typeof value === "function")) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampFit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function strList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/* The dedupe key comes from `@/lib/capture` — deliberately the SAME function the
 * capture link uses, or the extension and the store would disagree about what
 * counts as "a job I already have". It strips scheme, `www.`, the fragment,
 * tracking params and a trailing slash, but **keeps meaningful query params**:
 * `indeed.com/viewjob?jk=…` is a different job per `jk`, and a normalizer that
 * threw the query away would collapse an entire job board into one card. */

/** Copies only the keys the caller actually set — `{ notes: undefined }` must not blank a field. */
function applyPatch<T extends object>(target: T, patch: Partial<T>): T {
  const next = { ...target };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) next[key] = value as T[keyof T];
  }
  return next;
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof StoreError) return e.message;
  if (e instanceof Error && e.message) return `${fallback} (${e.message})`;
  return fallback;
}

/** Everything except `updatedAt` — used so a write that changed nothing stays a no-op. */
function jobUnchanged(a: Job, b: Job): boolean {
  return (
    JSON.stringify({ ...a, updatedAt: "" }) ===
    JSON.stringify({ ...b, updatedAt: "" })
  );
}

/** Scores are compared without their timestamp, or a rescore always looks like a change. */
function sameScore(a: JobScore | null, b: JobScore | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    JSON.stringify({ ...a, scoredAt: "" }) ===
    JSON.stringify({ ...b, scoredAt: "" })
  );
}

/**
 * A score the rule engine owns and may freely replace. An LLM score (Tier 2) is
 * left alone by edits and settings changes — it cost money and a rules pass is
 * not an upgrade over it. `rescoreAll()` is the explicit override.
 */
function isReplaceableScore(score: JobScore | null): boolean {
  return score === null || score.engine.startsWith("rules");
}

const SCORING_FIELDS = [
  "title",
  "description",
  "company",
  "location",
  "budgetHint",
] as const;

function scoringInputChanged(a: Job, b: Job): boolean {
  return SCORING_FIELDS.some((field) => a[field] !== b[field]);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/**
 * Everything about a track that changes a number. `tone` is not on the list —
 * recolouring a badge must not churn every score on the board — but `name` and
 * `description` are, because the rule scorer reads both (engagement shape,
 * seniority band, description echo) and the Tier 2 prompt judges against the
 * description directly.
 *
 * Order matters too: it is the tie-break in `deriveFromProfiles`, so a reorder
 * can genuinely change which track is "best" at equal fit.
 */
function profilesAffectScoring(a: Profile[], b: Profile[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((profile, i) => {
    const other = b[i]!;
    return (
      profile.id !== other.id ||
      profile.name !== other.name ||
      profile.short !== other.short ||
      profile.description !== other.description ||
      !sameList(profile.keywords, other.keywords) ||
      !sameList(profile.excludeKeywords, other.excludeKeywords)
    );
  });
}

/**
 * Which settings the scorers actually read. `profileName` and `bio` are not
 * among them, so editing your bio does not churn every score on the board.
 */
function settingsAffectScoring(
  a: PursuitSettings,
  b: PursuitSettings,
): boolean {
  return (
    a.targetHourlyRate !== b.targetHourlyRate ||
    !sameList(a.eligibleLocations, b.eligibleLocations) ||
    profilesAffectScoring(a.profiles, b.profiles)
  );
}

/** Never write the API key into bytes that leave this machine. */
function redact(doc: PursuitDoc): PursuitDoc {
  return { ...doc, settings: { ...doc.settings, anthropicApiKey: "" } };
}

function serialize(doc: PursuitDoc): string {
  return JSON.stringify(doc, null, 2);
}

/* ───────────────────────── Validation / repair ───────────────────────── */

/**
 * Hand-rolled, because there is no schema library in this app and there does not
 * need to be. The posture is deliberate:
 *
 *   - **Reject** a document that is not ours (wrong `kind`, newer schema). Those
 *     are user errors with a correct answer, and importing them would produce
 *     nonsense.
 *   - **Repair** everything else. A missing field, a number where a string
 *     belongs, a half-written score — coerce it and move on. Throwing away
 *     someone's 200 captured jobs because one of them lost its `location` is not
 *     a defensible trade.
 */
type ParseResult =
  | { ok: true; doc: PursuitDoc }
  | { ok: false; error: string };

/**
 * Scores are keyed by profile id, so repair cannot know the key set in advance —
 * it copies whatever is there and lets `reconcileScoreToProfiles()` (called by
 * the caller, which knows the settings) prune orphans and re-derive the
 * aggregates. Splitting it this way is what lets a document survive a track
 * being renamed between export and import.
 */
function repairScore(raw: unknown, profiles: Profile[]): JobScore | null {
  if (!isRecord(raw)) return null;

  const rawProfiles = isRecord(raw.profileScores) ? raw.profileScores : {};
  const profileScores: ProfileScores = {};
  for (const [key, entry] of Object.entries(rawProfiles)) {
    if (!key) continue;
    const record = isRecord(entry) ? entry : null;
    const score: ProfileScore = {
      fit: clampFit(num(record?.fit, 0)),
      reasoning: str(record?.reasoning),
    };
    profileScores[key] = score;
  }

  const maxFit = Object.values(profileScores).reduce(
    (best, entry) => Math.max(best, entry.fit),
    0,
  );

  const score: JobScore = {
    fitScore: clampFit(num(raw.fitScore, maxFit)),
    bestProfile: typeof raw.bestProfile === "string" ? raw.bestProfile : null,
    matchedProfiles: strList(raw.matchedProfiles),
    profileScores,
    redFlags: strList(raw.redFlags),
    greenFlags: strList(raw.greenFlags),
    reasoning: str(raw.reasoning),
    engine: str(raw.engine, "imported"),
    scoredAt: str(raw.scoredAt) || now(),
  };

  return reconcileScoreToProfiles(score, profiles);
}

function repairJob(raw: unknown, ts: string, profiles: Profile[]): Job | null {
  if (!isRecord(raw)) return null;

  const title = str(raw.title).trim();
  const description = str(raw.description).trim();
  // A row with neither a title nor a description is not a job, it is noise.
  if (!title && !description) return null;

  return {
    id: str(raw.id).trim() || newId(),
    title: title || "Untitled role",
    company: str(raw.company).trim(),
    description,
    url: str(raw.url).trim(),
    source: str(raw.source).trim() || "import",
    location: str(raw.location).trim(),
    budgetHint: str(raw.budgetHint).trim(),
    pipelineStatus: isPipelineStatus(raw.pipelineStatus)
      ? raw.pipelineStatus
      : "triage",
    notes: str(raw.notes),
    createdAt: str(raw.createdAt) || ts,
    updatedAt: str(raw.updatedAt) || ts,
    // Falls back through updatedAt so a document written before this field
    // existed heals itself on load — no migration function, no data loss. The
    // fallback is an approximation of history rather than history: the real
    // moment this card last moved was never recorded and cannot be recovered.
    statusChangedAt: str(raw.statusChangedAt) || str(raw.updatedAt) || ts,
    score: repairScore(raw.score, profiles),
  };
}

/* ─────────────────────── Profiles: repair + migration ─────────────────────── */

/** ≤10 chars, non-empty. A badge that wraps is a badge that breaks the row. */
function shortLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  const source = trimmed || fallback.trim() || "Track";
  return source.slice(0, 10);
}

function repairProfile(raw: unknown, index: number): Profile | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.name).trim();
  const description = str(raw.description).trim();
  const keywords = strList(raw.keywords).map((k) => k.trim()).filter(Boolean);
  const excludeKeywords = strList(raw.excludeKeywords)
    .map((k) => k.trim())
    .filter(Boolean);

  // A track with no name, no prose and no keywords cannot score anything and
  // cannot be labelled. That is not a repairable track, it is a blank row.
  if (!name && !description && keywords.length === 0) return null;

  return {
    id: str(raw.id).trim() || newId(),
    name: name || `Track ${index + 1}`,
    short: shortLabel(str(raw.short), name || `T${index + 1}`),
    description,
    keywords,
    excludeKeywords,
    tone: isColorTone(raw.tone) ? raw.tone : "green",
  };
}

/**
 * v1 → v2.
 *
 * A v1 document has three fixed scoring profiles baked into the *code* and two
 * flat keyword lists in settings. This turns those into real `Profile` objects
 * **reusing the three legacy ids**, which is the whole trick: every stored
 * `profileScores` key, `bestProfile` and `matchedProfiles` entry keeps
 * resolving, so nobody's board resets to unscored after the upgrade.
 *
 * What each track inherits:
 *   - `contract_stack` gets the user's actual `stackKeywords` — that is where
 *     they were hard-enforced, and they are the one genuinely personal thing in
 *     a v1 document.
 *   - `fte_pm` and `micro_async` had no keywords of their own in v1 (they ran on
 *     lexicons compiled into the scorer), so they are seeded from the matching
 *     presets. Without this they would score flat zero after the migration,
 *     which would look exactly like data loss.
 *   - all three inherit `excludeKeywords`. v1 enforced them hard on one track
 *     and lightly on the others; that distinction was invisible in the UI and
 *     impossible to explain. Uniform and editable beats clever and hidden.
 */
function migrateLegacyProfiles(raw: Record<string, unknown>): Profile[] {
  const base = defaultSettings();
  const stack = strList(raw.stackKeywords, base.profiles[0]!.keywords);
  const exclude = strList(raw.excludeKeywords, base.profiles[0]!.excludeKeywords);

  const seed = (
    id: string,
    name: string,
    short: string,
    tone: ColorTone,
    presetKey: string,
    keywords: string[],
  ): Profile => {
    const preset = findPreset(presetKey) ?? PROFILE_PRESETS[0]!;
    return {
      id,
      name,
      short,
      tone,
      description: preset.description,
      keywords,
      excludeKeywords: [...exclude],
    };
  };

  return [
    seed(
      LEGACY_PROFILE_IDS.contract,
      "Contract · stack",
      "Stack",
      "green",
      "swe_contract",
      stack,
    ),
    seed(LEGACY_PROFILE_IDS.fte, "FTE · PM", "PM", "blue", "product", [
      ...(findPreset("product")?.keywords ?? []),
    ]),
    seed(LEGACY_PROFILE_IDS.micro, "Micro · async", "Micro", "purple", "fixed_scope", [
      ...(findPreset("fixed_scope")?.keywords ?? []),
    ]),
  ];
}

/**
 * Always returns 1..MAX_PROFILES tracks with unique ids. Zero tracks would make
 * every job score a flat, unexplainable zero, and duplicate ids would make two
 * tracks share one score.
 */
function repairProfiles(raw: unknown): Profile[] {
  const base = defaultSettings();
  if (!isRecord(raw)) return base.profiles;

  const stored = Array.isArray(raw.profiles)
    ? raw.profiles
        .map((entry, index) => repairProfile(entry, index))
        .filter((p): p is Profile => p !== null)
    : [];

  // No `profiles` array at all, but the v1 keyword fields are present → this is
  // a pre-v2 document. Migrate rather than reset.
  const profiles =
    stored.length > 0
      ? stored
      : Array.isArray(raw.stackKeywords) || Array.isArray(raw.excludeKeywords)
        ? migrateLegacyProfiles(raw)
        : base.profiles;

  const seen = new Set<string>();
  const unique: Profile[] = [];
  for (const profile of profiles) {
    const id = seen.has(profile.id) ? newId() : profile.id;
    seen.add(id);
    unique.push(id === profile.id ? profile : { ...profile, id });
    if (unique.length >= MAX_PROFILES) break;
  }

  return unique.length > 0 ? unique : base.profiles;
}

function repairSettings(raw: unknown): PursuitSettings {
  const base = defaultSettings();
  if (!isRecord(raw)) return base;
  return {
    profileName: str(raw.profileName, base.profileName),
    bio: str(raw.bio, base.bio),
    profiles: repairProfiles(raw),
    targetHourlyRate: num(raw.targetHourlyRate, base.targetHourlyRate),
    // Anything that is not the string "annual" — including absent, which is
    // every document written before this field existed — means hourly.
    rateMode: raw.rateMode === "annual" ? "annual" : "hourly",
    eligibleLocations: strList(raw.eligibleLocations, base.eligibleLocations),
    anthropicApiKey: str(raw.anthropicApiKey),
  };
}

function parseDoc(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "This file isn’t valid JSON." };
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "This file isn’t a Bobi Pursuit pipeline." };
  }

  if (raw.kind !== DOC_KIND) {
    const found = typeof raw.kind === "string" ? `“${raw.kind}”` : "no";
    return {
      ok: false,
      error: `This file isn’t a Bobi Pursuit pipeline — it declares ${found} kind, expected “${DOC_KIND}”.`,
    };
  }

  const version = num(raw.schemaVersion, SCHEMA_VERSION);
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      // Reworded because this gate guards BOTH importJson and the localStorage
      // read in runInit(). The old text ("import it again") only made sense on
      // the import path; on the load path the reader is someone whose board
      // just came up empty, and the two things they need to know immediately
      // are that nothing was deleted and what to press.
      error: `This pipeline was written by a newer version of Bobi Pursuit (schema v${version}, this copy understands v${SCHEMA_VERSION}). Nothing has been deleted — your data is set aside untouched. Hard-refresh this page to pick up the current version, then it will open normally.`,
    };
  }

  const ts = now();
  // Settings first: a job's score is keyed by profile id, so repairing a score
  // needs the (possibly just-migrated) track list to reconcile against.
  const settings = repairSettings(raw.settings);

  const jobs: Job[] = [];
  if (Array.isArray(raw.jobs)) {
    for (const entry of raw.jobs) {
      const job = repairJob(entry, ts, settings.profiles);
      if (job) jobs.push(job);
    }
  }

  return {
    ok: true,
    doc: {
      kind: DOC_KIND,
      schemaVersion: SCHEMA_VERSION,
      createdAt: str(raw.createdAt) || ts,
      updatedAt: str(raw.updatedAt) || ts,
      settings,
      jobs,
    },
  };
}

/** Union by id, then by normalized url. Never clobbers what is already here. */
function mergeJobs(
  existing: Job[],
  incoming: Job[],
): { jobs: Job[]; imported: number } {
  const ids = new Set(existing.map((job) => job.id));
  const urls = new Set(
    existing.map((job) => normalizeUrl(job.url)).filter(Boolean),
  );

  const jobs = [...existing];
  let imported = 0;

  for (const job of incoming) {
    if (ids.has(job.id)) continue;
    const key = normalizeUrl(job.url);
    if (key && urls.has(key)) continue;
    ids.add(job.id);
    if (key) urls.add(key);
    jobs.push(job);
    imported += 1;
  }

  return { jobs, imported };
}

function isDefaultSettings(settings: PursuitSettings): boolean {
  const base = defaultSettings();
  return (
    JSON.stringify({ ...settings, anthropicApiKey: "" }) ===
    JSON.stringify({ ...base, anthropicApiKey: "" })
  );
}

/* ─────────────────────────────── Store ─────────────────────────────── */

export interface PursuitStoreOptions {
  /** Injected by tests. Production picks its own in `init()`. */
  adapter?: StorageAdapter | null;
  doc?: PursuitDoc;
  debounceMs?: number;
}

export class PursuitStore {
  private doc: PursuitDoc;
  private primary: StorageAdapter | null;
  /** Optional second sink — a real file. Mirrors every write; never the source of truth. */
  private secondary: StorageAdapter | null = null;

  private readonly debounceMs: number;
  private readonly listeners = new Set<() => void>();
  private status: StoreStatus = INITIAL_STATUS;

  private dirty = false;
  /**
   * Set when storage held bytes we could not parse *and* could not copy aside.
   * Autosave stays off until the user explicitly wipes — we do not overwrite a
   * document we failed to understand. That is how you eat someone's data.
   */
  private suspended = false;
  private destroyed = false;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: PursuitStoreOptions = {}) {
    this.doc = options.doc ?? EMPTY_DOC;
    this.primary = options.adapter ?? null;
    this.debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS;
    this.bindLifecycle();
  }

  /* ── subscription ── */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable between changes — a mutation is the only thing that swaps this reference. */
  getSnapshot = (): PursuitDoc => this.doc;

  /** Prerender/SSR. Frozen, deterministic, and it never reads storage. */
  getServerSnapshot = (): PursuitDoc => EMPTY_DOC;

  getStatus = (): StoreStatus => this.status;

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private setStatus(patch: Partial<StoreStatus>): void {
    const next: StoreStatus = { ...this.status, ...patch };
    // Identity is the change signal for `useSyncExternalStore`. A status object
    // that is equal but new would re-render every subscriber on every save tick.
    if (sameStatus(this.status, next)) return;
    this.status = Object.freeze(next);
    this.notify();
  }

  private adapterDescription(): { adapterId: string; adapterLabel: string } {
    const primary = this.primary;
    const secondary = this.secondary;
    if (!primary) {
      return { adapterId: "none", adapterLabel: "Not saved yet" };
    }
    if (!secondary) {
      return { adapterId: primary.id, adapterLabel: primary.label };
    }
    return {
      adapterId: `${primary.id}+${secondary.id}`,
      adapterLabel: `${primary.label} + ${secondary.label}`,
    };
  }

  /* ── lifecycle ── */

  /**
   * Read storage and install the real document. Call once, from a `useEffect` —
   * never during render. Repeat calls return the same promise, so a component
   * tree that mounts twice (React strict mode) reads once.
   */
  init = (): Promise<void> => {
    if (!this.initPromise) this.initPromise = this.runInit();
    return this.initPromise;
  };

  private async runInit(): Promise<void> {
    let unavailable: string | null = null;

    if (!this.primary) {
      const local = new LocalStorageAdapter();
      if (await local.isAvailable()) {
        this.primary = local;
      } else {
        // Safari private mode, or storage disabled by policy. The app still
        // works for this session — and says so, loudly, rather than pretending.
        this.primary = new MemoryAdapter();
        unavailable =
          "This browser is blocking local storage, so nothing will be kept when you close the tab. Export your pipeline before you leave.";
      }
    }

    const adapter = this.primary;
    let raw: string | null = null;
    let error: string | null = unavailable;

    try {
      raw = await adapter.load();
    } catch (e) {
      error = messageOf(e, "Could not read your saved pipeline.");
    }

    let stored: PursuitDoc | null = null;
    if (raw && raw.trim() !== "") {
      const parsed = parseDoc(raw);
      if (parsed.ok) {
        stored = parsed.doc;
      } else {
        const where = adapter.backup ? await adapter.backup(raw) : null;
        if (where) {
          error = `Your saved pipeline could not be read: ${parsed.error} The original was copied to “${where}” — nothing has been deleted. Starting from an empty pipeline.`;
        } else {
          this.suspended = true;
          error = `Your saved pipeline could not be read: ${parsed.error} It could not be copied aside either, so saving is paused rather than overwrite it. Use “Clear everything” to start over.`;
        }
      }
    }

    const base = stored ?? emptyDoc();

    if (this.doc === EMPTY_DOC) {
      this.doc = base;
    } else {
      // Something already wrote to the document before storage answered — the
      // `?add=1` capture link does exactly this. Merge rather than clobber; the
      // stored settings win, because nothing can have edited settings this early.
      const { jobs } = mergeJobs(base.jobs, this.doc.jobs);
      this.doc = { ...base, jobs, updatedAt: now() };
      this.dirty = true;
    }

    this.setStatus({
      ...this.adapterDescription(),
      loaded: true,
      error,
      lastSavedAt: stored ? stored.updatedAt : null,
    });
    this.notify();

    if (this.dirty) this.scheduleSave();
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") void this.flush();
  };

  private onPageHide = (): void => {
    // Works only because LocalStorageAdapter.save() calls setItem() synchronously
    // before it awaits anything — see the note in adapters/local-storage.ts.
    // Nothing async is guaranteed to run once the page is going away.
    void this.flush();
  };

  private bindLifecycle(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("beforeunload", this.onPageHide);
    // `beforeunload` does not fire reliably on mobile Safari; `pagehide` does.
    window.addEventListener("pagehide", this.onPageHide);
  }

  destroy = (): void => {
    this.destroyed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (typeof document !== "undefined" && typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      window.removeEventListener("beforeunload", this.onPageHide);
      window.removeEventListener("pagehide", this.onPageHide);
    }
    this.listeners.clear();
  };

  /* ── persistence ── */

  private scheduleSave(): void {
    if (!this.primary || this.suspended || this.destroyed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueueWrite();
    }, this.debounceMs);
  }

  /**
   * Serializes writes — a save never overlaps a save. Note that the first write
   * is invoked **synchronously**, not chained off a resolved promise: on
   * `pagehide` the microtask queue may never be drained, and `setItem` has to
   * have already been called by then.
   */
  private enqueueWrite(): Promise<void> {
    if (this.inFlight) {
      const chained = this.inFlight.then(
        () => this.write(),
        () => this.write(),
      );
      this.inFlight = chained;
      return chained;
    }
    const started = this.write();
    this.inFlight = started;
    void started.then(
      () => {
        if (this.inFlight === started) this.inFlight = null;
      },
      () => {
        if (this.inFlight === started) this.inFlight = null;
      },
    );
    return started;
  }

  private async write(): Promise<void> {
    const primary = this.primary;
    if (!primary || !this.dirty || this.suspended || this.destroyed) return;
    // Never persist the prerender document over real bytes.
    if (this.doc === EMPTY_DOC) return;

    const json = serialize(this.doc);
    const secondary = this.secondary;
    this.dirty = false;
    this.setStatus({ saving: true });

    let failure: string | null = null;

    try {
      await primary.save(json);
    } catch (e) {
      // The change is still only in memory. Keep it dirty so the next flush
      // retries, and put the failure where the UI has to render it.
      this.dirty = true;
      failure = messageOf(e, "Could not save your pipeline.");
    }

    if (secondary && this.secondary === secondary) {
      try {
        // The file copy is redacted: a file on disk is a file that gets emailed,
        // synced, and committed. The browser copy keeps the key.
        await secondary.save(serialize(redact(this.doc)));
      } catch (e) {
        // The browser copy already succeeded, so nothing is lost — but a badge
        // that says "saving to <file>" must stop being true out loud.
        failure ??= messageOf(e, `Could not save to ${secondary.label}.`);
      }
    }

    this.setStatus({
      saving: false,
      error: failure,
      lastSavedAt: failure ? this.status.lastSavedAt : now(),
    });
  }

  /** Write now. Resolves even on failure — the error lives in `getStatus().error`. */
  flush = (): Promise<void> => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.enqueueWrite();
  };

  /* ── optional file sink ─────────────────────────────────────────────────
   * A strict addition to localStorage, never a replacement, and deliberately
   * session-scoped: handles survive a reload but their permission does not, and
   * a "Saving to pipeline.json" badge that silently stopped being true is worse
   * than one that disappears. Chrome/Edge only; `isFileSystemAccessSupported()`
   * is the gate the UI checks before rendering the button.
   */

  get fileSyncSupported(): boolean {
    return isFileSystemAccessSupported();
  }

  /** Attach a file and immediately mirror the current document into it. */
  attachFile = (handle: FileSystemFileHandle): Promise<void> => {
    this.secondary = createFileSystemAdapter(handle);
    this.dirty = true;
    this.setStatus({ ...this.adapterDescription(), error: null });
    return this.flush();
  };

  detachFile = (): void => {
    this.secondary = null;
    this.setStatus({ ...this.adapterDescription() });
  };

  /* ── the commit primitive ── */

  /**
   * The only way the document ever changes. Returning `null` from `fn` means
   * "nothing actually changed" — and a no-op must NOT bump `updatedAt` or swap
   * the snapshot reference.
   */
  private commit(
    fn: (doc: PursuitDoc, ts: string) => PursuitDoc | null,
    ts: string = now(),
  ): void {
    // Mutating before `init()` has answered is legal — the `?add=1` capture link
    // does it — but the prerender document is frozen and dated to the epoch, so
    // it can never become the real one. Swap in a genuine empty document first;
    // `runInit()` will merge whatever storage turns out to hold.
    const current = this.doc === EMPTY_DOC ? emptyDoc() : this.doc;
    const next = fn(current, ts);
    if (!next) return;
    this.doc = { ...next, updatedAt: ts };
    this.dirty = true;
    this.scheduleSave();
    this.notify();
  }

  /* ── scoring ── */

  private scoreWith(
    job: Pick<Job, "title" | "description" | "company" | "location" | "budgetHint">,
    settings: PursuitSettings,
  ): JobScore | null {
    try {
      return scoreJobWithRules(
        {
          title: job.title,
          description: job.description,
          company: job.company,
          location: job.location,
          budgetHint: job.budgetHint,
        },
        settings,
      );
    } catch {
      // A scorer bug must not take the app down or lose the capture. The job
      // lands unscored and the next rescore picks it up.
      return null;
    }
  }

  /**
   * The one place scores are refreshed in bulk.
   *
   * Two paths, and the distinction is the load-bearing part:
   *
   *   - a score the **rule engine owns** is simply recomputed;
   *   - a score **Claude produced** is *reconciled* — orphan track keys pruned,
   *     new tracks shown as an honest "not assessed", aggregates re-derived —
   *     but never recomputed. It cost real money and a rules pass is a
   *     downgrade, not a refresh. `replaceLlmScores` is the explicit override.
   *
   * This is what makes renaming, adding, deleting and reordering a track safe:
   * the board stays coherent without silently spending or discarding anything.
   */
  private rescoreJobs(
    jobs: Job[],
    settings: PursuitSettings,
    ts: string,
    replaceLlmScores = false,
  ): { jobs: Job[]; changed: boolean } {
    let changed = false;
    const next = jobs.map((job) => {
      const current = job.score;
      const score =
        current !== null && !replaceLlmScores && !isReplaceableScore(current)
          ? reconcileScoreToProfiles(current, settings.profiles)
          : this.scoreWith(job, settings);
      if (sameScore(current, score)) return job;
      changed = true;
      return { ...job, score, updatedAt: ts };
    });
    return { jobs: next, changed };
  }

  /* ── jobs ── */

  private makeJob(
    input: Partial<Job> & { title: string; description: string },
    ts: string,
    settings: PursuitSettings,
  ): Job {
    const base: Omit<Job, "score"> = {
      id: str(input.id).trim() || newId(),
      title: input.title.trim(),
      company: str(input.company).trim(),
      description: input.description.trim(),
      url: str(input.url).trim(),
      source: str(input.source).trim() || "manual",
      location: str(input.location).trim(),
      budgetHint: str(input.budgetHint).trim(),
      pipelineStatus: isPipelineStatus(input.pipelineStatus)
        ? input.pipelineStatus
        : "triage",
      notes: str(input.notes),
      createdAt: str(input.createdAt) || ts,
      updatedAt: ts,
      statusChangedAt: str(input.statusChangedAt) || ts,
    };
    return { ...base, score: input.score ?? this.scoreWith(base, settings) };
  }

  /**
   * Capture a job. Scores it on the way in — a job in triage with no number next
   * to it is a job you have to read, which is the work this tool exists to avoid.
   *
   * Deduped on normalized url: re-capturing a posting you already have returns
   * the job you already have, unchanged, rather than a second card. Newest first.
   */
  addJob = (input: Partial<Job> & { title: string; description: string }): Job => {
    const url = str(input.url).trim();
    if (url) {
      const existing = this.findByUrl(url);
      if (existing) return existing;
    }

    const ts = now();
    const job = this.makeJob(input, ts, this.doc.settings);
    this.commit((doc) => ({ ...doc, jobs: [job, ...doc.jobs] }), ts);
    return job;
  };

  updateJob = (id: string, patch: Partial<Job>): void => {
    this.commit((doc, ts) => {
      const index = doc.jobs.findIndex((job) => job.id === id);
      if (index < 0) return null;

      const prev = doc.jobs[index]!;
      const next: Job = {
        ...applyPatch<Job>(prev, patch),
        // Identity and birth date are the store's, not the caller's.
        id: prev.id,
        createdAt: prev.createdAt,
        updatedAt: ts,
      };

      // Editing the text a score was derived from invalidates that score. We
      // rescore silently rather than show a number that no longer describes the
      // job — but never over the top of an LLM score the user paid for.
      if (
        patch.score === undefined &&
        scoringInputChanged(prev, next) &&
        isReplaceableScore(next.score)
      ) {
        next.score = this.scoreWith(next, doc.settings);
      }

      if (jobUnchanged(prev, next)) return null;

      const jobs = [...doc.jobs];
      jobs[index] = next;
      return { ...doc, jobs };
    });
  };

  setPipelineStatus = (id: string, status: PipelineStatus): void => {
    this.commit((doc, ts) => {
      const index = doc.jobs.findIndex((job) => job.id === id);
      if (index < 0 || doc.jobs[index]!.pipelineStatus === status) return null;
      const jobs = [...doc.jobs];
      // The ONLY place statusChangedAt moves. That is what makes it answer
      // "how long has this been sitting here" when updatedAt cannot: updatedAt
      // also moves on a note edit, so it measures attention, not waiting.
      jobs[index] = {
        ...jobs[index]!,
        pipelineStatus: status,
        updatedAt: ts,
        statusChangedAt: ts,
      };
      return { ...doc, jobs };
    });
  };

  deleteJob = (id: string): void => {
    this.commit((doc) => {
      const jobs = doc.jobs.filter((job) => job.id !== id);
      return jobs.length === doc.jobs.length ? null : { ...doc, jobs };
    });
  };

  /** Install a score from outside the rule engine (Tier 2's LLM pass), or clear one. */
  setScore = (id: string, score: JobScore | null): void => {
    this.commit((doc, ts) => {
      const index = doc.jobs.findIndex((job) => job.id === id);
      if (index < 0) return null;
      const prev = doc.jobs[index]!;
      if (sameScore(prev.score, score)) return null;
      const jobs = [...doc.jobs];
      jobs[index] = { ...prev, score, updatedAt: ts };
      return { ...doc, jobs };
    });
  };

  /**
   * Re-run the rule scorer over every job the rule engine owns.
   *
   * `replaceLlmScores` defaults to **false**: an LLM score cost the user real
   * money, and overwriting it with a rules pass is a downgrade, not a refresh.
   * The caller has to ask for that explicitly — and the settings sheet only
   * offers the option when there is actually something to lose, so the
   * destructive edge is visible at the moment it exists rather than hidden in a
   * button labelled "rescore".
   */
  rescoreAll = (replaceLlmScores = false): void => {
    this.commit((doc, ts) => {
      const { jobs, changed } = this.rescoreJobs(
        doc.jobs,
        doc.settings,
        ts,
        replaceLlmScores,
      );
      return changed ? { ...doc, jobs } : null;
    });
  };

  findByUrl = (url: string): Job | undefined => {
    const key = normalizeUrl(url);
    if (!key) return undefined;
    return this.doc.jobs.find((job) => normalizeUrl(job.url) === key);
  };

  /* ── settings ── */

  /**
   * The single write path for settings.
   *
   * `transform` runs *inside* the commit, against the live document, so a caller
   * that computed the new value from a slightly stale read cannot clobber
   * anything. Returning `null` means "nothing to do".
   *
   * Changing what you are looking for invalidates every number on the board, so
   * a scoring-relevant edit rescores. Anything else would show yesterday's
   * numbers under today's tracks and quietly look broken.
   */
  private commitSettings(
    transform: (settings: PursuitSettings) => PursuitSettings | null,
  ): void {
    this.commit((doc, ts) => {
      const settings = transform(doc.settings);
      if (!settings) return null;
      if (JSON.stringify(settings) === JSON.stringify(doc.settings)) return null;

      if (!settingsAffectScoring(doc.settings, settings)) {
        return { ...doc, settings };
      }

      const { jobs } = this.rescoreJobs(doc.jobs, settings, ts);
      return { ...doc, settings, jobs };
    });
  }

  updateSettings = (patch: Partial<PursuitSettings>): void => {
    this.commitSettings((settings) => applyPatch(settings, patch));
  };

  /* ── tracks (scoring profiles) ─────────────────────────────────────────────
   * The v2 model: what you are looking for is data you own, not three constants
   * compiled into the app. Every mutation here goes through `commitSettings`, so
   * every one of them rescores rule-owned jobs and reconciles LLM-scored ones.
   */

  /** Appends a track. Returns it, or `null` when already at `MAX_PROFILES`. */
  addProfile = (input: Partial<Profile> & { name: string }): Profile | null => {
    const existing = this.doc.settings.profiles;
    const name = input.name.trim() || "New track";
    const profile: Profile = {
      id: str(input.id).trim() || newId(),
      name,
      short: shortLabel(str(input.short), name),
      description: str(input.description),
      keywords: input.keywords ?? [],
      excludeKeywords: input.excludeKeywords ?? [],
      tone: isColorTone(input.tone) ? input.tone : nextTone(existing),
    };

    let added = false;
    this.commitSettings((settings) => {
      if (settings.profiles.length >= MAX_PROFILES) return null;
      if (settings.profiles.some((p) => p.id === profile.id)) return null;
      added = true;
      return { ...settings, profiles: [...settings.profiles, profile] };
    });

    return added ? profile : null;
  };

  /** Convenience for the onboarding picker. Unknown key → `null`. */
  addProfileFromPreset = (presetKey: string): Profile | null => {
    const preset = findPreset(presetKey);
    if (!preset) return null;
    return this.addProfile({
      name: preset.name,
      short: preset.short,
      description: preset.description,
      keywords: [...preset.keywords],
      excludeKeywords: [...preset.excludeKeywords],
      // Tone comes from `nextTone` rather than the preset: two presets share a
      // colour, and two tracks the same colour is a badge that lies.
    });
  };

  /** `id` is not patchable — the id is what keeps existing scores resolving. */
  updateProfile = (id: string, patch: Partial<Omit<Profile, "id">>): void => {
    this.commitSettings((settings) => {
      const index = settings.profiles.findIndex((p) => p.id === id);
      if (index < 0) return null;

      const prev = settings.profiles[index]!;
      const merged = applyPatch(prev, patch as Partial<Profile>);
      const next: Profile = {
        ...merged,
        id: prev.id,
        name: merged.name.trim() || prev.name,
        short: shortLabel(merged.short, merged.name || prev.name),
        tone: isColorTone(merged.tone) ? merged.tone : prev.tone,
      };

      const profiles = [...settings.profiles];
      profiles[index] = next;
      return { ...settings, profiles };
    });
  };

  /**
   * Deletes a track. Refuses to remove the last one — zero tracks would score
   * every job a flat, unexplainable zero, which reads as a broken app.
   *
   * Scores keyed to the deleted id are not hunted down and deleted; they are
   * reconciled away by the rescore this triggers. An LLM score keeps its
   * judgements for the tracks that remain.
   */
  removeProfile = (id: string): boolean => {
    let removed = false;
    this.commitSettings((settings) => {
      if (settings.profiles.length <= MIN_PROFILES) return null;
      const profiles = settings.profiles.filter((p) => p.id !== id);
      if (profiles.length === settings.profiles.length) return null;
      removed = true;
      return { ...settings, profiles };
    });
    return removed;
  };

  /**
   * Reorders tracks. Order is meaningful twice over: it is the display order,
   * and it is the tie-break in `deriveFromProfiles`, so the track you list first
   * wins a dead heat. Ids not in `orderedIds` keep their relative position at
   * the end rather than vanishing.
   */
  reorderProfiles = (orderedIds: string[]): void => {
    this.commitSettings((settings) => {
      const byId = new Map(settings.profiles.map((p) => [p.id, p]));
      const profiles: Profile[] = [];
      for (const id of orderedIds) {
        const profile = byId.get(id);
        if (profile && !profiles.includes(profile)) profiles.push(profile);
      }
      for (const profile of settings.profiles) {
        if (!profiles.includes(profile)) profiles.push(profile);
      }
      return { ...settings, profiles };
    });
  };

  /** Up/down buttons, since there is no drag-and-drop library in this app. */
  moveProfile = (id: string, delta: number): void => {
    const ids = this.doc.settings.profiles.map((p) => p.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(ids.length - 1, from + delta));
    if (to === from) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    this.reorderProfiles(ids);
  };

  /* ── portability ── */

  /** Pretty JSON, with `settings.anthropicApiKey` stripped. Always. */
  exportJson = (): string => serialize(redact(this.doc));

  /**
   * Merge an export back in. Never destructive: existing jobs are kept, incoming
   * duplicates (same id, or same normalized url) are skipped, and a document
   * that fails validation changes nothing at all.
   *
   * Settings are adopted only into a pristine document — importing your backup
   * on a fresh install restores your profile; importing a colleague's export
   * into your configured app does not overwrite it. An imported API key is
   * discarded either way.
   */
  importJson = (json: string): { ok: boolean; error?: string; imported: number } => {
    const parsed = parseDoc(json);
    if (!parsed.ok) return { ok: false, error: parsed.error, imported: 0 };

    const incoming = parsed.doc;
    const ts = now();
    const pristine =
      this.doc.jobs.length === 0 && isDefaultSettings(this.doc.settings);

    const settings: PursuitSettings = pristine
      ? { ...incoming.settings, anthropicApiKey: this.doc.settings.anthropicApiKey }
      : this.doc.settings;

    // Imported scores were computed against whatever tracks the exporting
    // document had. Rule scores are simply recomputed under the settings that
    // are actually in force; an LLM score is reconciled, not thrown away, so a
    // track that survived the round trip keeps its judgement.
    const { jobs: merged, imported } = mergeJobs(this.doc.jobs, incoming.jobs);
    const { jobs } = this.rescoreJobs(merged, settings, ts);

    this.commit((doc) => {
      const settingsChanged =
        JSON.stringify(settings) !== JSON.stringify(doc.settings);
      const jobsChanged =
        imported > 0 || jobs.some((job, i) => job !== doc.jobs[i]);
      if (!settingsChanged && !jobsChanged) return null;
      return { ...doc, settings, jobs };
    }, ts);

    return { ok: true, imported };
  };

  /**
   * Seed the demo pipeline. Merged, not installed: loading the sample can never
   * cost someone the jobs they already captured, and loading it twice is a no-op
   * because the sample urls dedupe against themselves.
   *
   * Returns the number actually imported, which is 0 on that second press.
   * It used to return void, and every caller therefore assumed success —
   * Settings showed "Sample pipeline loaded — ten illustrative jobs" over a
   * board that had not changed. A no-op reported as success is worse than a
   * failure, because the user believes the app and blames themselves. Callers
   * that surface a result MUST branch on this number; `importJson` alongside
   * already did, which is why the same press on the import path told the truth.
   */
  loadSample = (): number => {
    const ts = now();
    const settings = this.doc.settings;
    // The seed module ships jobs deliberately UNSCORED, so the demo always
    // reflects the user's current scoring settings rather than numbers baked in
    // when the fixtures were written. `makeJob` scores each one on the way in.
    const seeded = sampleJobs().map((job) => this.makeJob(job, ts, settings));
    const { jobs, imported } = mergeJobs(this.doc.jobs, seeded);
    if (imported === 0) return 0;
    this.commit((doc) => ({ ...doc, jobs }), ts);
    return imported;
  };

  /**
   * Delete everything — jobs, settings, and the persisted copy. This is the only
   * destructive operation in the app; the UI must confirm it. It also lifts a
   * corrupt-load suspension, because wiping is exactly the explicit consent that
   * suspension was waiting for.
   */
  clearAll = (): void => {
    this.doc = emptyDoc();
    this.dirty = false;
    this.suspended = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.notify();
    void this.wipeStorage();
  };

  private async wipeStorage(): Promise<void> {
    const targets = [this.primary, this.secondary].filter(
      (adapter): adapter is StorageAdapter => adapter !== null,
    );
    let failure: string | null = null;
    for (const adapter of targets) {
      try {
        await adapter.clear();
      } catch (e) {
        failure ??= messageOf(e, `Could not clear ${adapter.label}.`);
      }
    }
    this.setStatus({ error: failure, lastSavedAt: null, saving: false });
  }
}

/**
 * The singleton. One document, one store, imported directly wherever it is
 * needed — there is no provider and no context, because there is exactly one of
 * these per tab and pretending otherwise would be ceremony.
 */
export const store = new PursuitStore();
