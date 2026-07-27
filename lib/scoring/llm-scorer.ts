// Tier 2 — scoring with the user's own Anthropic key, from the browser.
//
// Same app, same tracks, same caps. The only thing that changes is who makes the
// per-track judgement: `rule-scorer.ts` sums named keyword signals, this asks
// Claude to read the user's own prose description and judge against it.
// Everything downstream — `fitScore`, `matchedProfiles`, `bestProfile`, the flag
// vocabulary — is derived by the SAME functions the rule scorer uses, so a job
// scored by Claude and a job scored by rules are still directly comparable on
// the board.
//
// The tracks are addressed positionally in the prompt (`track_1`, `track_2`) and
// mapped back to profile ids here, by index, off the SAME `settings.profiles`
// array that built the prompt. Never ask a model to echo a UUID.
//
// Three things this file will not do:
//
// 1. **Duplicate the caps.** Geographic ineligibility, the implied-hourly
//    salary floor and the undisclosed-budget soft cap are imported from
//    `rule-scorer.ts` (`extractScoreCaps` / `applyCaps` / `deriveFromProfiles`).
//    Each exists because of a real bug; a second copy would drift.
// 2. **Swallow an error.** Every failure returns a typed, renderable result.
//    A silent fallback to rule scores would let someone believe they were
//    getting LLM judgement while their key was rejected forty times.
// 3. **Touch the key.** It is read from settings, put in one header, and never
//    logged, thrown, embedded in an error message, or written to an export
//    (`store.exportJson()` strips it).
//
// NETWORK NOTE: `anthropic-dangerous-direct-browser-access` is required for a
// browser fetch to api.anthropic.com — without it the request fails CORS
// preflight. The name is a warning about the trust model, not about this call:
// it means the key lives on the client, which is the entire premise of the
// bring-your-own-key tier.

import {
  applyCaps,
  deriveFromProfiles,
  extractScoreCaps,
  resolveContradictions,
  type JobInput,
} from "@/lib/scoring/rule-scorer";
import { buildScoringPrompt, trackKey } from "@/lib/scoring/prompt";
import type {
  Job,
  JobScore,
  Profile,
  ProfileScores,
  PursuitSettings,
} from "@/lib/types";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Also written to `score.engine`, which is how every surface tells the tiers apart. */
export const LLM_MODEL = "claude-haiku-4-5";

const MAX_TOKENS = 900;

/**
 * Rough, deliberately rounded-up, and shown to the user BEFORE a bulk run.
 * Haiku 4.5 is $1/M input and $5/M output; a scoring call is ~1.2k in and
 * ~350 out, so ≈$0.0029. Quoting $0.004 means the real bill comes in under the
 * estimate, which is the only direction an estimate should ever be wrong.
 */
export const COST_PER_JOB_USD = 0.004;

export function estimateCostUsd(jobCount: number): string {
  const total = jobCount * COST_PER_JOB_USD;
  if (total < 0.01) return "under $0.01";
  return `about $${total.toFixed(2)}`;
}

/** `score.engine` is `"rules-v1"` for the rule engine and the model id for this one. */
export function isLlmScore(score: JobScore | null): boolean {
  return score !== null && score.engine !== "" && !score.engine.startsWith("rules");
}

/* ─────────────────────────────── Results ─────────────────────────────── */

/**
 * Every distinguishable failure the user can actually act on. The kinds exist so
 * the UI can say "your key was rejected" instead of "something went wrong", and
 * so a bulk run can stop early on the ones that will repeat 40 times.
 */
export type LlmErrorKind =
  | "no_key" // nothing to send
  | "no_profiles" // nothing to score against
  | "auth" // 401 / 403 — bad, revoked, or wrong-org key
  | "rate_limit" // 429 — too fast, or out of credit
  | "network" // fetch threw: offline, blocked, or CORS
  | "api" // 4xx/5xx with a message from Anthropic
  | "malformed" // 200, but the body was not the JSON we asked for
  | "cancelled"; // the user aborted

export interface LlmFailure {
  ok: false;
  kind: LlmErrorKind;
  /** Already phrased for a human. Render it verbatim. */
  message: string;
}

export type LlmScoreResult = { ok: true; score: JobScore } | LlmFailure;
export type LlmTestResult = { ok: true } | LlmFailure;

/** Worth stopping a bulk run over — retrying 39 more times cannot help. */
export function isFatal(kind: LlmErrorKind): boolean {
  return (
    kind === "no_key" ||
    kind === "no_profiles" ||
    kind === "auth" ||
    kind === "rate_limit" ||
    kind === "network"
  );
}

function fail(kind: LlmErrorKind, message: string): LlmFailure {
  return { ok: false, kind, message };
}

/* ──────────────────────────── The single call ──────────────────────────── */

/**
 * Score one job. Resolves — never throws — so a caller can render the failure
 * next to the job it belongs to.
 */
export async function scoreJobWithClaude(
  job: JobInput,
  settings: PursuitSettings,
  options: { signal?: AbortSignal } = {},
): Promise<LlmScoreResult> {
  const apiKey = settings.anthropicApiKey.trim();
  if (!apiKey) {
    return fail("no_key", "No Anthropic API key set. Add one in Settings → AI scoring.");
  }
  if (settings.profiles.length === 0) {
    return fail(
      "no_profiles",
      "There are no tracks to score against. Add at least one in Settings → What you're looking for.",
    );
  }

  const body = JSON.stringify({
    model: LLM_MODEL,
    max_tokens: MAX_TOKENS,
    // Scoring is a rubric task: the same posting should get the same number
    // twice. Low, not zero — zero is not a determinism guarantee either way.
    temperature: 0.1,
    messages: [{ role: "user", content: buildScoringPrompt(job, settings) }],
  });

  const call = await postMessages(apiKey, body, options.signal);
  if (!call.ok) return call;

  const parsed = parseScoreResponse(call.text, settings.profiles);
  if (!parsed.ok) return parsed;

  return { ok: true, score: buildScore(parsed.value, job, settings) };
}

/**
 * One cheap call, purely to find out whether the key works. `max_tokens: 1` —
 * the answer is thrown away; only the status code matters.
 */
export async function testApiKey(
  apiKey: string,
  signal?: AbortSignal,
): Promise<LlmTestResult> {
  const key = apiKey.trim();
  if (!key) return fail("no_key", "Paste a key first.");

  const call = await postMessages(
    key,
    JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
    signal,
  );
  return call.ok ? { ok: true } : call;
}

/**
 * The one place a request is made. Returns the concatenated text of the
 * response, or a typed failure — the key never appears in either.
 */
async function postMessages(
  apiKey: string,
  body: string,
  signal?: AbortSignal,
): Promise<{ ok: true; text: string } | LlmFailure> {
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
        // Required for a browser-origin request; without it this fails CORS.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body,
      signal,
    });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      return fail("cancelled", "Cancelled.");
    }
    // fetch() rejects without a status for offline, DNS failure, a blocking
    // extension, and CORS alike — the browser deliberately does not say which.
    return fail(
      "network",
      "Could not reach api.anthropic.com. Check your connection, and any extension or network policy that blocks it — nothing else in this app makes network calls.",
    );
  }

  if (!response.ok) {
    const detail = await readApiError(response);
    if (response.status === 401 || response.status === 403) {
      return fail(
        "auth",
        `Anthropic rejected that key (${response.status}). Check it is a current key from console.anthropic.com and that the workspace has credit.${detail}`,
      );
    }
    if (response.status === 429) {
      return fail(
        "rate_limit",
        `Rate limited by Anthropic (429). Wait a minute and try again — or check your usage limits if this repeats.${detail}`,
      );
    }
    if (response.status >= 500) {
      return fail("api", `Anthropic returned a ${response.status}. This is their side — try again shortly.${detail}`);
    }
    return fail("api", `Anthropic returned ${response.status}.${detail}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return fail("malformed", "Anthropic returned a response that was not JSON.");
  }

  const text = extractText(payload);
  if (text.trim() === "") {
    return fail("malformed", "Anthropic returned an empty response.");
  }
  return { ok: true, text };
}

/** Best-effort extra context from an error body. Never includes the request. */
async function readApiError(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (isRecord(data) && isRecord(data.error) && typeof data.error.message === "string") {
      return ` (${data.error.message})`;
    }
  } catch {
    // An error body that is not JSON tells us nothing worth saying.
  }
  return "";
}

/** `content` is a block list; only the text blocks matter here. */
function extractText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.content)) return "";
  return payload.content
    .map((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("");
}

/* ──────────────────────────────── Parsing ──────────────────────────────── */

interface RawScore {
  /** Keyed by real profile id — the positional `track_N` mapping already applied. */
  tracks: Record<string, { fit: number; reasoning: string }>;
  employmentType: string;
  locationType: string;
  redFlags: string[];
  greenFlags: string[];
}

/**
 * Defensive on purpose. The prompt says "no markdown", and the model complies
 * almost always — "almost" is not a thing to build on, so a fenced block or a
 * sentence of preamble is recovered rather than failed.
 *
 * `profiles` is the same array that built the prompt, so `track_N` maps back to
 * `profiles[N-1].id` by position. A track the model skipped is left out of the
 * result entirely rather than defaulted to zero — `buildScore` turns that into
 * an explicit "no assessment returned", which is honest, where a silent 0 would
 * read as a judgement.
 */
function parseScoreResponse(
  text: string,
  profiles: Profile[],
): { ok: true; value: RawScore } | LlmFailure {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  if (!isRecord(parsed)) {
    return fail(
      "malformed",
      `Claude replied with something that was not the expected JSON: “${cleaned.slice(0, 120)}…”. Try again — this is usually transient.`,
    );
  }

  // `profiles` is the v2 key; `tracks` is what the prompt asks for. Accept
  // either — the model occasionally reaches for the word in the heading.
  const tracksRaw = isRecord(parsed.tracks)
    ? parsed.tracks
    : isRecord(parsed.profiles)
      ? parsed.profiles
      : {};

  const tracks: RawScore["tracks"] = {};
  for (const [index, profile] of profiles.entries()) {
    // Positional key first, then the real id, then the track's own name — the
    // last two are pure charity toward a model that ignored the instruction.
    const entry =
      tracksRaw[trackKey(index)] ?? tracksRaw[profile.id] ?? tracksRaw[profile.name];
    if (!isRecord(entry) || !Number.isFinite(Number(entry.fit))) continue;
    tracks[profile.id] = {
      fit: clamp(Number(entry.fit)),
      reasoning:
        typeof entry.reasoning === "string" ? entry.reasoning.slice(0, 400) : "",
    };
  }

  // Zero usable numbers means we got valid JSON of the wrong shape. Installing
  // a row of zeroes as a "score" would be worse than saying so.
  if (Object.keys(tracks).length === 0) {
    return fail("malformed", "Claude's reply had no track scores in it. Try again.");
  }

  return {
    ok: true,
    value: {
      tracks,
      employmentType: typeof parsed.employment_type === "string" ? parsed.employment_type : "unclear",
      locationType: typeof parsed.location_type === "string" ? parsed.location_type : "unclear",
      redFlags: strings(parsed.red_flags),
      greenFlags: strings(parsed.green_flags),
    },
  };
}

/* ───────────────────────── Caps → the final score ───────────────────────── */

/**
 * The model proposes; the deterministic rules dispose.
 *
 * Identical to the rule scorer's own post-pass because it IS the rule scorer's
 * own post-pass: same `applyCaps`, same `deriveFromProfiles`, same
 * contradiction resolution. An LLM that is charitable about a posting whose
 * required location the user cannot meet gets overruled exactly as the rules
 * would overrule themselves.
 */
function buildScore(raw: RawScore, job: JobInput, settings: PursuitSettings): JobScore {
  const caps = extractScoreCaps(job, settings);

  const profileScores: ProfileScores = {};
  for (const profile of settings.profiles) {
    const entry = raw.tracks[profile.id] ?? { fit: 0, reasoning: "" };
    const capped = applyCaps(profile, clamp(entry.fit), caps);
    const notes = [
      entry.reasoning.trim() || "no assessment returned for this track",
      ...capped.capNotes,
    ];
    profileScores[profile.id] = {
      fit: capped.fit,
      reasoning: notes.join(" · ").slice(0, 400),
    };
  }

  const derived = deriveFromProfiles(profileScores, settings.profiles);

  // Keep the flags honest with the caps that actually fired — the model cannot
  // know we overrode it.
  const red = [...raw.redFlags];
  if (caps.geoIneligible && !red.includes("out_of_stack")) red.push("out_of_stack");
  if (caps.lowballAnnual && !red.includes("lowball_budget")) red.push("lowball_budget");
  // A talent-network listing is not a job you can bid on today. The model is
  // asked to classify it; this is where that classification earns its keep.
  if (raw.employmentType === "talent_network" && !red.includes("talent_network")) {
    red.push("talent_network");
  }
  const { redFlags, greenFlags } = resolveContradictions(red, raw.greenFlags);

  const classification = [raw.employmentType, raw.locationType]
    .filter((v) => v && v !== "unclear")
    .join(" · ");

  return {
    fitScore: derived.fitScore,
    bestProfile: derived.bestProfile,
    matchedProfiles: derived.matchedProfiles,
    profileScores,
    redFlags,
    greenFlags,
    reasoning: (classification ? `${derived.reasoning} (${classification})` : derived.reasoning).slice(0, 1000),
    engine: LLM_MODEL,
    scoredAt: new Date().toISOString(),
  };
}

/* ────────────────────────────── Bulk scoring ────────────────────────────── */

export interface BulkProgress {
  done: number;
  total: number;
  failed: number;
}

export interface BulkSummary {
  scored: number;
  failed: number;
  cancelled: boolean;
  /** The failure that stopped the run, or the last one seen. */
  error: LlmFailure | null;
}

/**
 * Score many jobs with small concurrency.
 *
 * Concurrency is 3 and not configurable upward: this is someone's personal API
 * key on a personal rate limit, and the difference between 40 jobs in 25s and
 * 40 jobs in 12s is not worth a 429 that strands the run halfway.
 *
 * Stops on the first fatal failure (bad key, rate limit, offline) — those
 * repeat, and burning 39 more requests to prove it is rude with someone else's
 * money. Per-job malformed replies are counted and skipped.
 */
export async function scoreJobsWithClaude(
  jobs: Job[],
  settings: PursuitSettings,
  handlers: {
    onScored: (jobId: string, score: JobScore) => void;
    onProgress?: (progress: BulkProgress) => void;
    signal?: AbortSignal;
    concurrency?: number;
  },
): Promise<BulkSummary> {
  const total = jobs.length;
  const concurrency = Math.max(1, Math.min(3, handlers.concurrency ?? 3));

  let cursor = 0;
  let scored = 0;
  let failed = 0;
  let stopped = false;
  let error: LlmFailure | null = null;

  const report = () => handlers.onProgress?.({ done: scored + failed, total, failed });

  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopped || handlers.signal?.aborted) return;
      const index = cursor;
      cursor += 1;
      if (index >= jobs.length) return;

      const job = jobs[index]!;
      const result = await scoreJobWithClaude(job, settings, { signal: handlers.signal });

      if (result.ok) {
        scored += 1;
        handlers.onScored(job.id, result.score);
      } else {
        error = result;
        if (result.kind === "cancelled") {
          stopped = true;
          return;
        }
        failed += 1;
        if (isFatal(result.kind)) {
          stopped = true;
          report();
          return;
        }
      }
      report();
    }
  };

  report();
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));

  const cancelled = handlers.signal?.aborted === true;
  return { scored, failed, cancelled, error: cancelled ? null : error };
}

/* ─────────────────────────────── Utilities ─────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
