// Deterministic, client-side job scorer — the free tier's whole brain.
//
// ONE generic scorer, driven entirely by the user's own tracks.
//
// v1 shipped three bespoke heuristics — a stack-hit weighting table, a PM-title
// regex, a fixed-scope lexicon — which were, plainly, one person's job search
// compiled into the source. They scored well for exactly that person and were
// noise for everyone else. v2 deletes all three and replaces them with a single
// scorer that reads `Profile.keywords` / `Profile.excludeKeywords` plus the
// signals that are true of *any* job hunt: was the money disclosed, is the scope
// real, does the seniority of the title match what this track says it wants, is
// the engagement shape the one you asked for, is the posting still warm.
//
// What did NOT change, and must not:
//   1. Geographic ineligibility caps EVERY track at 25. A role whose required
//      location the user cannot meet is untakeable no matter how good the
//      keyword match is.
//   2. Implied-hourly ANNUAL salary detection caps every track at 25 — but only
//      with genuine annual context AND no project-budget framing. v1 shipped a
//      bug where "$12k-$18k for the build" on a 6-week MVP was read as an
//      $8.65/hr salary and hard-rejected a 92-fit job.
//   3. The undisclosed-budget soft cap at 60, and its exemption. An undisclosed
//      salary is NORMAL for a salaried posting; capping those was v1's other
//      real bug. v1 hardcoded the exemption to `fte_pm`; v2 generalises it to
//      "the posting is salaried, or this track says it wants salaried work",
//      which is the same rule without the hardcoded name.
//   4. Contradictory flags are resolved, not shipped. A readout a reviewer
//      cannot trust is worse than no readout.
//
// EXPLAINABILITY IS THE CONTRACT: every signal that moved a number is named in
// that track's `reasoning` string, in the words of the thing that fired. If a
// user disagrees with a score they can read which term caused it and edit their
// own keywords — which is the entire reason to run rules instead of a model.
//
// PURE + DETERMINISTIC: no I/O, no randomness, no clock reads except the
// `scoredAt` stamp at the very end. Same input, same output, forever — which is
// what makes `store.rescoreAll()` safe to run on every settings change.

import type {
  Job,
  JobScore,
  Profile,
  ProfileScores,
  PursuitSettings,
} from "@/lib/types";
import { PROFILE_MATCH_THRESHOLD } from "@/lib/types";
import {
  ANNUAL_CONTEXT_RE,
  BIG_SCOPE_RE,
  CLEAR_SCOPE_RE,
  CONCRETE_QUANTITY_RE,
  CONTRACT_FRAMING_TERMS,
  DEFAULT_ELIGIBLE_LOCATIONS,
  FAST_DECISION_RE,
  FIXED_SCOPE_RE,
  FTE_FRAMING_TERMS,
  HOURLY_CONTEXT_RE,
  INTENT_CONTRACT_TERMS,
  INTENT_FIXED_TERMS,
  INTENT_FULLTIME_TERMS,
  INTENT_JUNIOR_RE,
  INTENT_SENIOR_RE,
  JUNIOR_TITLE_RE,
  OPEN_LOCATION_RE,
  POSTED_AGO_RE,
  POSTED_AGO_WORDY_RE,
  PROJECT_CONTEXT_RE,
  RACE_TO_BOTTOM_TERMS,
  REQUIRED_LOCATION_RE,
  SENIOR_TITLE_RE,
  TEXT_STOPWORDS,
  URGENT_TIMELINE_RE,
  VAGUE_SCOPE_RE,
  compactText,
  countTerm,
  termHit,
  unnegatedTermHit,
} from "./profiles";

const ENGINE = "rules-v2";

// A very short posting with no concrete deliverable is genuinely
// under-specified — not a stylistic judgement, an information one.
const THIN_POST_CHARS = 200;

// Full-time-equivalent hours, used to convert an annual figure to an hourly
// one. 2080 is the conservative (highest) divisor.
// Exported so the settings UI converts with the SAME number the scorer judges
// against. A second copy in a component is how a field starts disagreeing with
// the thing it configures.
export const FTE_HOURS_PER_YEAR = 2080;

/**
 * The weights, in one place, so they can be argued with.
 *
 * A track starts at BASE and every signal is a named addition or subtraction.
 * A bullseye (keywords in the title, the engagement shape you asked for, money
 * on the table, scope spelled out) reaches 100; a posting with none of your
 * vocabulary and the wrong shape lands at 0. Nothing in between is a mystery.
 */
const W = {
  BASE: 22,
  /** Per keyword found in the TITLE — where the job actually declares itself. */
  TITLE_HIT: 12,
  TITLE_HIT_CAP: 3,
  /** Per additional keyword found only in the body. */
  BODY_HIT: 5,
  BODY_HIT_CAP: 4,
  /** Charged once, not once per absent signal. */
  NO_KEYWORDS: -12,
  /** Shared vocabulary between this track's prose and the posting. */
  DESCRIPTION_ECHO: 2,
  DESCRIPTION_ECHO_MAX: 6,
  DESCRIPTION_ECHO_MIN_HITS: 2,
  /** The posting's engagement shape is one this track asked for. */
  SHAPE_MATCH: 14,
  /** The posting clearly declares a shape this track did not ask for. */
  SHAPE_MISMATCH: -20,
  SENIORITY_MATCH: 8,
  /** A senior track looking at a junior posting. The expensive direction. */
  SENIORITY_TOO_JUNIOR: -18,
  /** A junior/entry track looking at a senior posting. */
  SENIORITY_TOO_SENIOR: -8,
  EXCLUDE_PER_HIT: -15,
  EXCLUDE_MAX: -45,
  BUDGET_DISCLOSED: 6,
  BUDGET_UNDISCLOSED: -4,
  MONEY_AT_TARGET: 6,
  CLEAR_SCOPE: 5,
  VAGUE_SCOPE: -8,
  RACE_TO_BOTTOM: -12,
  UNREALISTIC_TIMELINE: -5,
  STALE: -8,
  FAST_DECISION: 4,
} as const;

export type JobInput = Pick<
  Job,
  "title" | "description" | "company" | "location" | "budgetHint"
>;

/* ──────────────────────────────────────────────────────────────────
 * Track intent — what the user's own prose asks for
 *
 * The rule tier cannot *understand* a description, but it can read the few
 * things that description is declaring in plain, checkable language: what shape
 * of engagement, what seniority band, and which words this person's world is
 * made of. That is the honest limit of rules, and it is stated out loud in the
 * reasoning strings so nobody mistakes it for comprehension.
 * ────────────────────────────────────────────────────────────────── */

export type SeniorityBand = "senior" | "junior" | "none";

export interface ProfileIntent {
  wantsContract: boolean;
  wantsFullTime: boolean;
  wantsFixedScope: boolean;
  band: SeniorityBand;
  /** Distinctive words from the description, minus stopwords and keywords. */
  descriptionTokens: string[];
}

export function deriveProfileIntent(profile: Profile): ProfileIntent {
  const text = `${profile.name} ${profile.short} ${profile.description}`.toLowerCase();
  const compact = compactText(text);

  const hasAny = (terms: string[]): boolean =>
    terms.some((term) => termHit(text, compact, term));

  const band: SeniorityBand = INTENT_SENIOR_RE.test(text)
    ? "senior"
    : INTENT_JUNIOR_RE.test(text)
      ? "junior"
      : "none";

  return {
    wantsContract: hasAny(INTENT_CONTRACT_TERMS),
    wantsFullTime: hasAny(INTENT_FULLTIME_TERMS),
    wantsFixedScope: hasAny(INTENT_FIXED_TERMS),
    band,
    descriptionTokens: descriptionTokens(profile),
  };
}

/**
 * Turns the prose description into matchable domain tokens.
 *
 * Deliberately weak (capped at +6 of ~100) and deliberately explicit about why:
 * a token overlap is a coincidence detector, not comprehension. Words already in
 * `keywords` are removed so a term cannot be paid for twice, and the stopword
 * list strips career boilerplate — otherwise every posting "matches".
 */
function descriptionTokens(profile: Profile): string[] {
  const inKeywords = new Set<string>();
  for (const keyword of profile.keywords) {
    for (const word of keyword.toLowerCase().split(/[^a-z0-9+#.]+/)) {
      if (word) inKeywords.add(word.replace(/[.]+$/, ""));
    }
  }

  const words =
    profile.description.toLowerCase().match(/[a-z][a-z0-9+#.]{3,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const token = raw.replace(/[.]+$/, "");
    if (token.length < 4) continue;
    if (TEXT_STOPWORDS.has(token) || inKeywords.has(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    out.push(token);
    if (out.length >= 30) break;
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────
 * Deterministic caps
 *
 * Exported because Tier 2's LLM scorer applies the SAME caps to the model's
 * numbers (`extractScoreCaps` → `applyCaps` → `deriveFromProfiles`). Each cap
 * exists because of a real misfire, and a second copy of the logic in the LLM
 * path WOULD drift — so that path imports these rather than restating them.
 * ────────────────────────────────────────────────────────────────── */

export interface ScoreCaps {
  geoIneligible: boolean;
  arrangementIneligible: boolean;
  lowballAnnual: boolean;
  hasBudgetSignal: boolean;
  /** The posting itself is framed as salaried. Exempts it from the budget cap. */
  fteFramed: boolean;
}

/** The cap-relevant subset of the full signal extraction. */
export function extractScoreCaps(
  job: JobInput,
  settings: PursuitSettings,
): ScoreCaps {
  return capsOf(extractSignals(job, settings));
}

function capsOf(s: Signals): ScoreCaps {
  return {
    geoIneligible: s.geoIneligible,
    arrangementIneligible: s.arrangementIneligible,
    lowballAnnual: s.lowballAnnual,
    hasBudgetSignal: s.hasBudgetSignal,
    fteFramed: s.fteFraming,
  };
}

export function applyCaps(
  profile: Profile,
  fit: number,
  s: ScoreCaps,
): { fit: number; capNotes: string[] } {
  const capNotes: string[] = [];
  let out = fit;

  // Track-independent: nobody can take a role they're not eligible for.
  if (s.geoIneligible && out > 25) {
    out = 25;
    capNotes.push("capped at 25: required location is outside your eligible regions");
  }
  // Track-independent: an annual figure implying single-digit hourly is below
  // Same shape as the geographic cap, and equally track-independent: the way
  // the work is done does not change per track.
  if (s.arrangementIneligible && out > 25) {
    out = 25;
    capNotes.push("capped at 25: the posting's work arrangement is one you excluded");
  }

  // any track's floor.
  if (s.lowballAnnual && out > 25) {
    out = 25;
    capNotes.push("capped at 25: disclosed salary implies an hourly rate far below target");
  }
  // Work you have to price, with no price named. Exempt when the posting is
  // salaried, or when this track says it is after salaried work — an
  // undisclosed band is normal there, and capping it was v1's real bug.
  const salaryContext = s.fteFramed || deriveProfileIntent(profile).wantsFullTime;
  if (!s.hasBudgetSignal && !salaryContext && out > 60) {
    out = 60;
    capNotes.push("capped at 60: no budget or rate disclosed");
  }

  return { fit: out, capNotes };
}

/* ──────────────────────────────────────────────────────────────────
 * Public entry point
 * ────────────────────────────────────────────────────────────────── */

export function scoreJobWithRules(
  job: JobInput,
  settings: PursuitSettings,
): JobScore {
  const signals = extractSignals(job, settings);
  const caps = capsOf(signals);
  const profiles = settings.profiles;

  const profileScores: ProfileScores = {};
  let keywordTitleHits = 0;
  let keywordTotalHits = 0;
  const excludeHits = new Set<string>();

  for (const profile of profiles) {
    const intent = deriveProfileIntent(profile);
    const hits = keywordHits(profile, signals);
    const tally = scoreProfile(profile, intent, hits, signals);
    const capped = applyCaps(profile, clamp(tally.fit), caps);

    profileScores[profile.id] = {
      fit: capped.fit,
      reasoning: buildReasoning(tally.notes, capped.capNotes),
    };

    keywordTitleHits = Math.max(keywordTitleHits, hits.inTitle.length);
    keywordTotalHits = Math.max(
      keywordTotalHits,
      hits.inTitle.length + hits.inBody.length,
    );
    for (const hit of hits.excluded) excludeHits.add(hit);
  }

  const derived = deriveFromProfiles(profileScores, profiles);
  const { redFlags, greenFlags } = buildFlags(signals, {
    keywordTitleHits,
    keywordTotalHits,
    excludeHits: [...excludeHits],
  });

  return {
    fitScore: derived.fitScore,
    bestProfile: derived.bestProfile,
    matchedProfiles: derived.matchedProfiles,
    profileScores,
    redFlags,
    greenFlags,
    reasoning: derived.reasoning,
    engine: ENGINE,
    scoredAt: new Date().toISOString(),
  };
}

/* ──────────────────────────────────────────────────────────────────
 * Aggregate derivation
 *   fitScore        = MAX track fit — the kanban and every threshold read it
 *   matchedProfiles = tracks at/above the match threshold, best first (ids)
 *   bestProfile     = the top track's id, but ONLY if it actually matched
 *                     (a max of 40 means nothing really fit → null)
 *   reasoning       = the winning track's one-liner, tagged with its name
 *
 * Walks `profiles`, never `scores` — so an orphan key left behind by a deleted
 * track can never win, and a track added after the score was written shows up
 * as an honest zero rather than a missing row.
 * ────────────────────────────────────────────────────────────────── */

export function deriveFromProfiles(
  scores: ProfileScores,
  profiles: Profile[],
): {
  fitScore: number;
  matchedProfiles: string[];
  bestProfile: string | null;
  reasoning: string;
} {
  if (profiles.length === 0) {
    return {
      fitScore: 0,
      matchedProfiles: [],
      bestProfile: null,
      reasoning: "No tracks configured — add one in Settings to start scoring.",
    };
  }

  const fitOf = (id: string): number => scores[id]?.fit ?? 0;

  // Array.prototype.sort is stable, so ties fall back to the user's own track
  // order — the tie-break is deterministic, not incidental.
  const ranked = [...profiles].sort((a, b) => fitOf(b.id) - fitOf(a.id));
  const top = ranked[0]!;
  const fitScore = Math.round(fitOf(top.id));
  const matchedProfiles = ranked
    .filter((p) => fitOf(p.id) >= PROFILE_MATCH_THRESHOLD)
    .map((p) => p.id);
  const bestProfile = fitScore >= PROFILE_MATCH_THRESHOLD ? top.id : null;

  const topReasoning = scores[top.id]?.reasoning ?? "no signals matched this track";
  const reasoning = bestProfile
    ? `[${top.name}] ${topReasoning}`
    : `[best: ${top.name}, weak] ${topReasoning}`;

  return { fitScore, matchedProfiles, bestProfile, reasoning: reasoning.slice(0, 1000) };
}

/**
 * Bring an existing score into line with the current set of tracks — **without
 * rescoring it**.
 *
 * This is what keeps an LLM score (which cost real money) alive across a track
 * being renamed, added, deleted or reordered. Orphan keys are dropped, tracks
 * with no assessment are shown as an honest zero, and the aggregate fields are
 * re-derived. The per-track judgements themselves are never touched.
 */
export function reconcileScoreToProfiles(
  score: JobScore,
  profiles: Profile[],
): JobScore {
  const profileScores: ProfileScores = {};
  for (const profile of profiles) {
    const entry = score.profileScores[profile.id];
    profileScores[profile.id] = entry
      ? { fit: clamp(entry.fit), reasoning: entry.reasoning }
      : { fit: 0, reasoning: "not assessed for this track" };
  }

  const derived = deriveFromProfiles(profileScores, profiles);
  return {
    ...score,
    profileScores,
    fitScore: derived.fitScore,
    bestProfile: derived.bestProfile,
    matchedProfiles: derived.matchedProfiles,
    reasoning: derived.reasoning,
  };
}

/* ──────────────────────────────────────────────────────────────────
 * The one scorer
 * ────────────────────────────────────────────────────────────────── */

interface KeywordHits {
  inTitle: string[];
  /** Body hits with the title hits removed — a keyword is paid for once. */
  inBody: string[];
  excluded: string[];
}

function keywordHits(profile: Profile, s: Signals): KeywordHits {
  const inTitle = uniqueHits(profile.keywords, s.title, s.compactTitle);
  const inBody = uniqueHits(profile.keywords, s.body, s.compactBody).filter(
    (k) => !inTitle.includes(k),
  );
  return {
    inTitle,
    inBody,
    // Deal-breakers only count when the posting is not explicitly ruling them
    // out. "No unpaid trials" is a *good* sign, and charging -15 for it was a
    // real false negative on well-written postings.
    excluded: uniqueHits(
      profile.excludeKeywords,
      s.hay,
      s.compactHay,
      unnegatedTermHit,
    ),
  };
}

function scoreProfile(
  profile: Profile,
  intent: ProfileIntent,
  hits: KeywordHits,
  s: Signals,
): Tally {
  const t = tally(W.BASE);
  const titleCount = hits.inTitle.length;
  const bodyCount = hits.inBody.length;

  /* ── this track's own vocabulary ── */

  if (titleCount > 0) {
    bump(
      t,
      Math.min(W.TITLE_HIT_CAP, titleCount) * W.TITLE_HIT,
      `${titleCount} keyword${plural(titleCount)} in the title (${list(hits.inTitle)})`,
    );
  }
  if (bodyCount > 0) {
    bump(
      t,
      Math.min(W.BODY_HIT_CAP, bodyCount) * W.BODY_HIT,
      `${bodyCount} more in the body (${list(hits.inBody)})`,
    );
  }
  // Absence of evidence is charged ONCE. A terse posting with no keywords, no
  // declared shape and no budget would otherwise collect three separate
  // penalties for what is really a single fact: the posting is thin.
  if (titleCount === 0 && bodyCount === 0 && profile.keywords.length > 0) {
    bump(t, W.NO_KEYWORDS, "none of this track's keywords appear anywhere");
  }

  const echoes = intent.descriptionTokens.filter((token) =>
    termHit(s.hay, s.compactHay, token),
  );
  if (echoes.length >= W.DESCRIPTION_ECHO_MIN_HITS) {
    bump(
      t,
      Math.min(W.DESCRIPTION_ECHO_MAX, echoes.length * W.DESCRIPTION_ECHO),
      `${echoes.length} words shared with this track's description (${list(echoes)})`,
    );
  }

  if (hits.excluded.length > 0) {
    // Halved when the title still matches — "React app, no WordPress please"
    // names the excluded thing in order to rule it out, not to require it.
    let penalty = Math.max(
      W.EXCLUDE_MAX,
      W.EXCLUDE_PER_HIT * hits.excluded.length,
    );
    if (titleCount > 0) penalty = Math.round(penalty / 2);
    bump(
      t,
      penalty,
      `${hits.excluded.length} excluded keyword${plural(hits.excluded.length)} (${list(hits.excluded)})`,
    );
  }

  /* ── engagement shape ── */

  const jobShapes = describeJobShapes(s);
  const wantedShapes = describeWantedShapes(intent);
  if (wantedShapes.length > 0 && jobShapes.length > 0) {
    const overlap = jobShapes.filter((shape) => wantedShapes.includes(shape));
    if (overlap.length > 0) {
      bump(t, W.SHAPE_MATCH, `${overlap.join(" / ")} work, which this track asks for`);
    } else {
      bump(
        t,
        W.SHAPE_MISMATCH,
        `posting is ${jobShapes.join(" / ")} work; this track wants ${wantedShapes.join(" / ")}`,
      );
    }
  }

  /* ── seniority ── */

  if (intent.band === "senior") {
    if (s.juniorTitle) {
      bump(t, W.SENIORITY_TOO_JUNIOR, "junior/entry-level title, this track reads as senior");
    } else if (s.seniorTitle) {
      bump(t, W.SENIORITY_MATCH, "seniority in the title matches this track");
    }
  } else if (intent.band === "junior") {
    if (s.seniorTitle) {
      bump(t, W.SENIORITY_TOO_SENIOR, "senior title, this track reads as early-career");
    } else if (s.juniorTitle) {
      bump(t, W.SENIORITY_MATCH, "entry-level title matches this track");
    }
  }

  /* ── money, scope, freshness: true of any job hunt ── */

  if (s.hasBudgetSignal) bump(t, W.BUDGET_DISCLOSED, "pay disclosed");
  else bump(t, W.BUDGET_UNDISCLOSED, "no pay disclosed");
  if (s.fairBudget) bump(t, W.MONEY_AT_TARGET, "money at or above your target rate");
  if (s.raceToBottom) bump(t, W.RACE_TO_BOTTOM, "cheapest-wins language");

  if (s.clearScope) bump(t, W.CLEAR_SCOPE, "scope is spelled out");
  if (s.vagueScope && !s.clearScope) bump(t, W.VAGUE_SCOPE, "scope is vague");
  if (s.unrealisticTimeline) {
    bump(t, W.UNREALISTIC_TIMELINE, "large scope on an urgent deadline");
  }

  if (s.stale) bump(t, W.STALE, "posting reads as weeks old");
  if (s.fastDecision) bump(t, W.FAST_DECISION, "they say they are deciding fast");

  return t;
}

/** What the POSTING is, in plain words. Order is the order they get reported. */
function describeJobShapes(s: Signals): string[] {
  const shapes: string[] = [];
  // A fixed-price one-off IS contract work, so it implies both. The reverse does
  // not hold: a six-month contract is not a bounded one-off, which is why a
  // fixed-scope-only track still rejects it.
  if (s.fixedScope) shapes.push("fixed-scope");
  if (s.contractFraming || s.fixedScope) shapes.push("contract");
  if (s.fteFraming) shapes.push("full-time");
  return shapes;
}

/** What the TRACK asked for. */
function describeWantedShapes(intent: ProfileIntent): string[] {
  const shapes: string[] = [];
  if (intent.wantsFixedScope) shapes.push("fixed-scope");
  if (intent.wantsContract) shapes.push("contract");
  if (intent.wantsFullTime) shapes.push("full-time");
  return shapes;
}

/* ──────────────────────────────────────────────────────────────────
 * Flags
 * ────────────────────────────────────────────────────────────────── */

interface FlagContext {
  keywordTitleHits: number;
  keywordTotalHits: number;
  excludeHits: string[];
}

function buildFlags(
  s: Signals,
  ctx: FlagContext,
): { redFlags: string[]; greenFlags: string[] } {
  const red: string[] = [];
  const green: string[] = [];

  if (s.vagueScope && !s.clearScope) red.push("vague_scope");
  if (s.lowballAnnual || s.lowRate) red.push("lowball_budget");
  if (s.raceToBottom) red.push("race_to_bottom");
  if (
    s.geoIneligible ||
    (ctx.excludeHits.length > 0 && ctx.keywordTotalHits === 0)
  ) {
    red.push("out_of_stack");
  }
  if (s.unrealisticTimeline) red.push("unrealistic_timeline");
  if (s.stale) red.push("stale_post");

  if (s.clearScope) green.push("clear_scope");
  if (s.fairBudget) green.push("fair_budget");
  if (ctx.keywordTitleHits > 0 || ctx.keywordTotalHits >= 2) green.push("stack_match");
  if (s.hasBudgetSignal) green.push("disclosed_budget");
  if (s.fastDecision) green.push("fast_decision_signal");

  return resolveContradictions(red, green);
}

// A flag readout a reviewer can't trust is worse than no readout. When a green
// and its opposing red both fire, the sceptical side wins — this tool gates
// "should I spend an afternoon on this", so false confidence is the expensive
// error.
const CONTRADICTIONS: Array<[green: string, red: string]> = [
  ["stack_match", "out_of_stack"],
  ["fair_budget", "lowball_budget"],
  ["fair_budget", "race_to_bottom"],
  ["clear_scope", "vague_scope"],
];

export function resolveContradictions(
  red: string[],
  green: string[],
): { redFlags: string[]; greenFlags: string[] } {
  const greenSet = new Set(green);
  for (const [g, r] of CONTRADICTIONS) {
    if (greenSet.has(g) && red.includes(r)) greenSet.delete(g);
  }
  return {
    redFlags: Array.from(new Set(red)),
    greenFlags: green.filter((g) => greenSet.has(g)),
  };
}

/* ──────────────────────────────────────────────────────────────────
 * Signal extraction — everything that is true of the POSTING, once
 * ────────────────────────────────────────────────────────────────── */

interface Budget {
  disclosed: boolean;
  hourly: number | null; // highest hourly figure found
  annual: number | null; // highest figure in genuine annual context
  lump: number | null; // highest figure that is neither
}

interface Signals {
  title: string;
  body: string;
  hay: string;
  compactTitle: string;
  compactBody: string;
  compactHay: string;
  contractFraming: boolean;
  fteFraming: boolean;
  fixedScope: boolean;
  seniorTitle: boolean;
  juniorTitle: boolean;
  hasBudgetSignal: boolean;
  fairBudget: boolean;
  lowRate: boolean;
  raceToBottom: boolean;
  clearScope: boolean;
  vagueScope: boolean;
  unrealisticTimeline: boolean;
  fastDecision: boolean;
  stale: boolean;
  geoIneligible: boolean;
  lowballAnnual: boolean;
  /** The posting's work arrangement is one the user excluded. */
  arrangementIneligible: boolean;
}

function extractSignals(job: JobInput, settings: PursuitSettings): Signals {
  const title = (job.title ?? "").toLowerCase();
  const body = (job.description ?? "").toLowerCase();
  const company = (job.company ?? "").toLowerCase();
  const location = (job.location ?? "").toLowerCase();
  const budgetHint = (job.budgetHint ?? "").toLowerCase();

  const hay = [title, body, company, location, budgetHint].join("\n");
  const compactHay = compactText(hay);
  const compactTitle = compactText(title);
  const compactBody = compactText(body);
  // Money can live in the structured hint or in the prose; read both.
  const moneyText = `${budgetHint} ${body}`.replace(/\s+/g, " ");

  const target = settings.targetHourlyRate > 0 ? settings.targetHourlyRate : 75;

  // ── engagement shape ────────────────────────────────────────────
  const contractFraming =
    uniqueHits(CONTRACT_FRAMING_TERMS, hay, compactHay).length > 0;
  const fteHits = uniqueHits(FTE_FRAMING_TERMS, hay, compactHay);
  // One stray "equity" isn't a salaried posting; two markers or an explicit
  // "full-time" is.
  const fteFraming = fteHits.length >= 2 || /\bfull[-\s]time\b/.test(hay);

  // ── money ───────────────────────────────────────────────────────
  const budget = extractBudget(moneyText, budgetHint);
  // Requires an actual number: "competitive salary" is not a disclosed budget,
  // and letting it lift the undisclosed-budget cap would be a free 40 points.
  const hasBudgetSignal =
    budget.disclosed ||
    /(salary|hourly|rate|compensation|budget)[:\s][^.\n]{0,20}\d/.test(moneyText);
  const healthySalary =
    budget.annual !== null && budget.annual >= target * FTE_HOURS_PER_YEAR * 0.7;
  const fairBudget =
    (budget.hourly !== null && budget.hourly >= target * 0.8) ||
    healthySalary ||
    (budget.lump !== null && budget.lump >= target * 20);
  const lowRate = budget.hourly !== null && budget.hourly < target * 0.5;
  const raceToBottom =
    uniqueHits(RACE_TO_BOTTOM_TERMS, hay, compactHay).length > 0 ||
    (budget.hourly !== null && budget.hourly < target * 0.3);

  // ── scope / timeline ────────────────────────────────────────────
  const clearScope = CLEAR_SCOPE_RE.test(hay) || CONCRETE_QUANTITY_RE.test(hay);
  // A thin posting is under-specified — but only for work you have to price.
  // Salaried postings are routinely three lines long and that says nothing
  // about scope, so flagging them vague was pure noise.
  const thinPost = body.trim().length < THIN_POST_CHARS;
  const vagueScope =
    VAGUE_SCOPE_RE.test(hay) || (thinPost && !clearScope && !fteFraming);
  const bigScope = BIG_SCOPE_RE.test(hay);

  return {
    title,
    body,
    hay,
    compactTitle,
    compactBody,
    compactHay,
    contractFraming,
    fteFraming,
    fixedScope: FIXED_SCOPE_RE.test(hay),
    seniorTitle: SENIOR_TITLE_RE.test(title),
    juniorTitle: JUNIOR_TITLE_RE.test(title),
    hasBudgetSignal,
    fairBudget,
    lowRate,
    raceToBottom,
    clearScope,
    vagueScope,
    unrealisticTimeline: URGENT_TIMELINE_RE.test(hay) && bigScope,
    fastDecision: FAST_DECISION_RE.test(hay),
    stale: detectStalePost(hay),
    geoIneligible: isGeographicallyIneligible(
      job.description ?? "",
      job.location ?? "",
      settings.eligibleLocations,
    ),
    lowballAnnual: detectLowballAnnualSalary(moneyText, target),
    arrangementIneligible: isArrangementIneligible(
      hay,
      job.location ?? "",
      settings.workArrangements,
    ),
  };
}

/* ──────────────────────────────────────────────────────────────────
 * Work arrangement
 *
 * Separate from geographic eligibility because they answer different questions:
 * "remote" is how the work is done, "EU" is where you may do it, and a posting
 * can fail either independently.
 *
 * Reads the prose rather than trusting a structured field. A board's own
 * "remote" flag is wrong often enough to be useless on its own — the classic
 * case is a listing tagged remote whose description says "hybrid schedule,
 * three days in the office, we prefer candidates near the city".
 * ────────────────────────────────────────────────────────────────── */

const HYBRID_RE =
  /\bhybrid\b|\bin[-\s]office\b|\d\s*days?\s*(?:per|a)\s*week\s*in|\bdays?\s*in\s*(?:the\s*)?office\b/i;
const ONSITE_RE =
  /\bon[-\s]?site\b|\bonsite\b|\bin[-\s]person\b|\brelocat/i;
const REMOTE_RE = /\bremote\b|\bwork from home\b|\bwfh\b|\bdistributed team\b/i;

function isArrangementIneligible(
  hay: string,
  location: string,
  allowed: string[],
): boolean {
  // Empty means the setting was never chosen; treat as no opinion.
  if (!allowed || allowed.length === 0) return false;
  // All three selected is also no opinion, and skipping the regexes is free.
  if (allowed.length >= 3) return false;

  const text = `${location} \n ${hay}`;

  // Order matters: a hybrid posting nearly always also says "remote" somewhere
  // ("3 days remote"), so hybrid has to be decided before remote is believed.
  const looksHybrid = HYBRID_RE.test(text);
  const looksOnsite = !looksHybrid && ONSITE_RE.test(text);
  const looksRemote = !looksHybrid && !looksOnsite && REMOTE_RE.test(text);

  if (looksHybrid) return !allowed.includes("hybrid");
  if (looksOnsite) return !allowed.includes("onsite");
  if (looksRemote) return !allowed.includes("remote");

  // Says nothing either way. Never cap on silence — an unstated arrangement is
  // unknown, not disqualifying.
  return false;
}

/* ──────────────────────────────────────────────────────────────────
 * Geographic eligibility (ported — load-bearing)
 *
 * Only fires on an explicit "Required location:" / "Location:" line — a job that
 * merely MENTIONS India is not an India-only job. The structured `location`
 * field is folded in as a synthetic header so board captures with no prose
 * location line still get checked; a "|" terminator keeps the capture group from
 * running into the description.
 * ────────────────────────────────────────────────────────────────── */

function isGeographicallyIneligible(
  description: string,
  location: string,
  eligibleLocations: string[],
): boolean {
  const loc = location.trim();
  const text = loc ? `Location: ${loc} |\n${description}` : description;

  const m = text.match(REQUIRED_LOCATION_RE);
  if (!m) return false;
  const required = m[1].toLowerCase();

  // Openly remote or global → eligible.
  if (OPEN_LOCATION_RE.test(required)) return false;

  // Any of the user's own regions named in the requirement → eligible.
  const allowed =
    eligibleLocations.length > 0 ? eligibleLocations : DEFAULT_ELIGIBLE_LOCATIONS;
  for (const a of allowed) {
    if (a.trim() && countTerm(required, a) > 0) return false;
  }

  // The posting requires a location, it is not open/remote, and it names none
  // of the user's regions: the requirement cannot be met. Symmetric on purpose;
  // there is no built-in list of regions, only the user's own.
  return true;
}

/* ──────────────────────────────────────────────────────────────────
 * Implied-hourly annual salary (ported — read the comment before editing)
 *
 * A "$Xk-$Yk" range is ONLY a lowball signal when it is actually framed as
 * annual compensation. Founder/MVP posts constantly say "$12k-$18k for the
 * build / fixed / for the project" — that is normal contract money, not an
 * $8/hr salary. Treating every k-range as annual hard-rejected a 92-fit job.
 * Require an annual marker AND the absence of project-budget framing.
 * ────────────────────────────────────────────────────────────────── */

function detectLowballAnnualSalary(text: string, targetHourly: number): boolean {
  const annualCtx = ANNUAL_CONTEXT_RE.test(text);
  const projectCtx = PROJECT_CONTEXT_RE.test(text);
  const treatAsAnnual = annualCtx && !projectCtx;

  // Pattern 1: "$12k - $19k" — only when framed as annual salary.
  const range = text.match(/\$\s*(\d{1,3})[k,\s]*[-–]\s*\$?\s*(\d{1,3})\s*k/i);
  if (range && treatAsAnnual) {
    const max = parseInt(range[2], 10) * 1000;
    if (max / FTE_HOURS_PER_YEAR < targetHourly * 0.5) return true;
  }

  // Pattern 2: "$50,000 - $80,000" full form — same annual gate.
  const fullRange = text.match(
    /\$\s*([\d,]{4,})\s*[-–]\s*\$?\s*([\d,]{4,})\s*(?:per\s+year|\/year|\/yr|annually|annual)?/i,
  );
  if (fullRange && treatAsAnnual) {
    const max = parseInt(fullRange[2].replace(/,/g, ""), 10);
    if (max < targetHourly * FTE_HOURS_PER_YEAR * 0.5) return true;
  }

  // Pattern 3: "Salary: $X per year" — self-labelling, no project ambiguity.
  const single = text.match(
    /(?:compensation|salary|pay)[:\s]+\$\s*([\d,]+)\s*(?:per\s+year|\/year|annually|annual|\/yr)/i,
  );
  if (single) {
    const n = parseInt(single[1].replace(/,/g, ""), 10);
    if (n < targetHourly * FTE_HOURS_PER_YEAR * 0.5) return true;
  }

  return false;
}

/* ──────────────────────────────────────────────────────────────────
 * Budget extraction
 *
 * Walks every "$…" in the text and classifies it by the words AROUND it —
 * hourly, annual, or a lump sum. Same discipline as the lowball detector:
 * project framing next to a number means it is a project budget, not a wage.
 * ────────────────────────────────────────────────────────────────── */

function extractBudget(moneyText: string, budgetHint: string): Budget {
  // Constructed per call: a module-level /g regex would carry lastIndex
  // between jobs and make scoring order-dependent.
  const re = /\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?/gi;
  let hourly: number | null = null;
  let annual: number | null = null;
  let lump: number | null = null;

  let m: RegExpExecArray | null = re.exec(moneyText);
  while (m !== null) {
    const digits = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(digits)) {
      const suffix = (m[2] ?? "").toLowerCase();
      const value = digits * (suffix === "k" ? 1000 : suffix === "m" ? 1_000_000 : 1);
      const ctx = moneyText.slice(Math.max(0, m.index - 45), m.index + m[0].length + 35);

      if (HOURLY_CONTEXT_RE.test(ctx)) hourly = Math.max(hourly ?? 0, value);
      else if (ANNUAL_CONTEXT_RE.test(ctx) && !PROJECT_CONTEXT_RE.test(ctx)) {
        annual = Math.max(annual ?? 0, value);
      } else lump = Math.max(lump ?? 0, value);
    }
    m = re.exec(moneyText);
  }

  return {
    disclosed:
      hourly !== null || annual !== null || lump !== null || /\d/.test(budgetHint),
    hourly,
    annual,
    lump,
  };
}

/* ──────────────────────────────────────────────────────────────────
 * Freshness
 *
 * The free tier has no posted_at — jobs arrive by capture, not by scrape — so
 * staleness is read from the board's own "Posted N days ago" text when the
 * capture happened to include it. No clock read, so rescoring never flips it.
 * ────────────────────────────────────────────────────────────────── */

function detectStalePost(text: string): boolean {
  const m = text.match(POSTED_AGO_RE);
  if (!m) return POSTED_AGO_WORDY_RE.test(text);
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === "day") return n >= 21;
  if (unit === "week") return n >= 3;
  return true; // months / years
}

/* ──────────────────────────────────────────────────────────────────
 * Small helpers
 * ────────────────────────────────────────────────────────────────── */

interface Tally {
  fit: number;
  notes: string[];
}

function tally(base: number): Tally {
  return { fit: base, notes: [] };
}

// Only signals that actually moved the number get a note — that is the whole
// contract of the reasoning string.
function bump(t: Tally, delta: number, note: string): void {
  if (delta === 0) return;
  t.fit += delta;
  t.notes.push(note);
}

function buildReasoning(notes: string[], capNotes: string[]): string {
  const all = [...notes, ...capNotes];
  const text = all.length > 0 ? all.join(", ") : "no signals matched this track";
  return text.slice(0, 300);
}

// Deduped on the PUNCTUATION-STRIPPED form, so "full-time"/"full time" and
// "next.js"/"nextjs" count once. Without this, spelling variants inflate both
// the hit counts that drive scores and the reasoning string.
function uniqueHits(
  terms: string[],
  haystack: string,
  compactHaystack: string,
  hit: (haystack: string, compactHaystack: string, term: string) => boolean = termHit,
): string[] {
  // Every spelling is still TESTED — only the second HIT on the same key is
  // dropped, so "full time" in the text still counts when the list happens to
  // name "full-time" first.
  const hitKeys = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = (raw ?? "").trim().toLowerCase();
    if (!term) continue;
    const key = term.replace(/[.\s_-]/g, "");
    if (hitKeys.has(key)) continue;
    if (hit(haystack, compactHaystack, term)) {
      hitKeys.add(key);
      out.push(term);
    }
  }
  return out;
}

function list(terms: string[]): string {
  const head = terms.slice(0, 3).join(", ");
  return terms.length > 3 ? `${head} +${terms.length - 3} more` : head;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
