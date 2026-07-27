// The Tier 2 scoring prompt.
//
// THIS PROMPT GOT BETTER WHEN THE PROFILES STOPPED BEING HARDCODED.
//
// v1 pasted three fixed profile definitions into every request — contract dev
// work, senior PM roles, fixed-scope data gigs — which meant the model was
// judging every posting against one person's job search, however carefully
// worded. A designer using this app got a very articulate paragraph about
// Next.js.
//
// v2 sends the user's OWN tracks: their name for it, their prose description,
// their keywords. The model's job changes from "apply these three rubrics" to
// "read what this person said they want and judge honestly against it", which is
// the one thing a model is genuinely better at than a keyword scorer.
//
// That is exactly the free-vs-key ladder, and it is worth saying plainly:
//
//     The rule scorer matches your KEYWORDS.
//     The model understands your DESCRIPTION.
//
// A track whose description says "a seat close to engineering, with a real
// research loop" scores nothing extra in the free tier — none of those words are
// keywords. With a key, that sentence is the whole judgement.
//
// PORTED WORDING — two sentences below were arrived at by fixing real misfires
// against real postings, and a well-meaning edit will reintroduce both bugs:
//
//   1. "An undisclosed salary is NORMAL for a salaried posting — do NOT treat it
//      as a red flag for a track that asks for salaried work." Without it the
//      model floored every salaried role for not publishing a number.
//   2. The employment_type block's talent_network case. "Join our network of
//      senior engineers" is not a job you can bid on today, and the model
//      cheerfully scored those 85 until the distinction was spelled out with
//      examples.
//
// The deterministic caps described in the CRITICAL sections are ALSO applied in
// code after the model answers — see llm-scorer.ts. The prompt asks for the
// right answer; the caps guarantee it.

import type { Job, Profile, PursuitSettings } from "@/lib/types";

type PromptJob = Pick<
  Job,
  "title" | "description" | "company" | "location" | "budgetHint"
>;

/** The posting body is truncated, not summarised — the tail of a long JD is boilerplate. */
const MAX_DESCRIPTION_CHARS = 2000;

/** A track's prose is truncated too; nobody's rubric needs 4kb. */
const MAX_TRACK_DESCRIPTION_CHARS = 900;

const FALLBACK_BIO =
  "A candidate who has not filled in their bio yet. Judge purely on the tracks below.";

/**
 * The key each track is addressed by **in the prompt**.
 *
 * Deliberately positional (`track_1`, `track_2`) rather than the real profile
 * id: ids are UUIDs, and asking a model to echo a UUID back as a JSON key is a
 * malformed-response generator. `llm-scorer.ts` maps these back to real ids by
 * index, using the same `settings.profiles` array that built the prompt.
 */
export function trackKey(index: number): string {
  return `track_${index + 1}`;
}

export function buildScoringPrompt(
  job: PromptJob,
  settings: PursuitSettings,
): string {
  const bio = settings.bio.trim() || FALLBACK_BIO;
  const description = job.description.trim();
  const truncated = description.length > MAX_DESCRIPTION_CHARS;
  const body = truncated
    ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}...[truncated]`
    : description || "(no description captured)";

  const rate = settings.targetHourlyRate > 0 ? settings.targetHourlyRate : 75;
  const locations = list(settings.eligibleLocations, "remote");
  const profiles = settings.profiles;
  const count = profiles.length;

  const trackBlocks = profiles
    .map((profile, index) => renderTrack(profile, index))
    .join("\n\n");

  // No `//` comments in the example object, however tempting: a schema sketch
  // containing comments is an invitation to answer with comments, and then the
  // response is not JSON. The track's name goes inside the string instead.
  const responseKeys = profiles
    .map(
      (profile, index) =>
        `    "${trackKey(index)}": { "fit": <0-100>, "reasoning": "<=1 sentence on ${profile.name} — what tipped it" }${
          index < count - 1 ? "," : ""
        }`,
    )
    .join("\n");

  const opening =
    count === 1
      ? `You are screening one job posting for one person, against the single track
of work they described below. Score the posting against that track.`
      : `You are screening one job posting for one person who is pursuing ${count}
DISTINCT tracks of work. Score the posting SEPARATELY for each track — a posting
can be a bullseye on one and a zero on another, and that is the point.`;

  return `${opening}

The tracks below were written BY THIS PERSON, in their own words. They are not
categories you should reinterpret: the description is the rubric. Where a
description states a preference the posting does not address, that is a gap, not
a violation. Where the description states a hard requirement the posting
contradicts, score it low and say so.

WHO THEY ARE:
${bio}

THEIR TRACKS (score each 0-100 independently):

${trackBlocks}

SHARED CONSTRAINTS (true of the person, not of any one track):
- Target rate: $${rate}/hr
- Eligible to work: ${locations}

JOB:
Title: ${job.title || "(untitled)"}
Company: ${job.company || "unknown"}
Location: ${job.location || "unspecified"}
Budget: ${job.budgetHint || "unknown"}

Description:
${body}

ASSESS THIS JOB AND RESPOND WITH ONLY VALID JSON (no markdown, no commentary):

{
  "tracks": {
${responseKeys}
  },
  "employment_type": <"contract" | "talent_network" | "fte" | "contract_to_hire" | "unclear">,
  "location_type": <"remote" | "hybrid" | "onsite" | "unclear">,
  "red_flags": [<from this list ONLY: "vague_scope", "lowball_budget", "race_to_bottom", "scope_creep_risk", "out_of_stack", "unrealistic_timeline", "stale_post">],
  "green_flags": [<from this list ONLY: "clear_scope", "fair_budget", "stack_match", "disclosed_budget", "experienced_team", "fast_decision_signal">]
}

Use the exact track keys shown above. Return every track, even the ones that
score zero — a missing track reads as "not assessed", which is different from
"not a fit".

Per-track scoring bands (apply to EACH track's fit independently):
- 90+: Bullseye for that track. Clear, well-matched, disclosed fair terms.
- 75-89: Strong for that track. One minor gap.
- 60-74: Worth a look. Real but notable gaps, or an adjacent shape. CAP HERE if
  the work is something they would have to price (contract, freelance, one-off)
  and no budget is disclosed.
- 40-59: Long shot for that track.
- Under 40: Not this track.

CRITICAL — undisclosed pay:
An undisclosed salary is NORMAL for a salaried posting — do NOT treat it as a red
flag for a track that asks for salaried or full-time work. An undisclosed budget
on a contract or fixed-scope engagement IS a real gap, because that is work the
person has to price before they can respond.

employment_type guidance — read carefully, the distinction matters:
- "contract" = a SPECIFIC PROJECT that can be bid on TODAY. Examples: "Hire me to build X by Y date", "Looking for someone for our 3-month migration", "Need a person to deliver Z". Defined scope, defined deliverable, the buyer is asking for the work itself.
- "talent_network" = "join our marketplace/network for FUTURE work." Examples: "Senior Independent X" listings from talent marketplaces, vetted-network recruitment posts, applications to join a freelance platform's bench. The post is selling THE NETWORK to the candidate, not asking for project work. There is no specific deliverable, no specific buyer, no specific scope. These are pipeline opportunities, not gigs. CRUCIAL: do not classify these as "contract" — they are a different thing entirely, and a contract-seeking track should score them well below a real project.
- "fte" = full-time hire, salaried.
- "contract_to_hire" = explicitly framed as "contract with conversion to FT" or "C2H".
- "unclear" = nothing in the post indicates which.

location_type guidance:
- "remote" = post says "remote", "fully remote", "remote-first", "work from anywhere".
- "hybrid" = "hybrid", "X days in office per week", "remote with quarterly visits".
- "onsite" = "must be in [city]", "in-office", "no remote".
- "unclear" = nothing specified.

CRITICAL — geographic eligibility rule:
This person can work from: ${locations}. Postings that REQUIRE candidates to be in a region outside that set are NOT eligible regardless of how good the match is: a location requirement they cannot meet is a requirement, wherever it points. Score these in the 0-25 range on every track. Openly remote or worldwide postings are always eligible.

CRITICAL — implied-hourly rule:
A posting offering "$12k-$19k annually" or similar at a full-time schedule implies roughly $6-10/hr, far below this person's $${rate}/hr target. Score 0-20 with the lowball_budget red flag regardless of how clean the match looks. Note the inverse: "$12k-$18k for the build" on a fixed-scope project is NORMAL contract money, not a salary — do not treat a project budget as an annual figure.

CONSISTENCY (mandatory — flags must not contradict each other):
- "stack_match" and "out_of_stack" CANNOT both apply. Pick whichever is more true. "stack_match" = the work is a shape at least one track could take on. "out_of_stack" = wrong discipline, wrong platform, or not the kind of work any track describes.
- "fair_budget" and "lowball_budget" CANNOT both apply.
- "fair_budget" and "race_to_bottom" CANNOT both apply.
- "clear_scope" and "vague_scope" CANNOT both apply.
- "disclosed_budget" requires an actual NUMBER in the posting. "competitive salary" is not a disclosed budget.
A reviewer reading your output should be able to trust that each flag is a real signal, not a hedge.

Be honest. Do NOT inflate scores. This person's time is expensive — false positives waste it.`;
}

/** One track, as the model sees it. */
function renderTrack(profile: Profile, index: number): string {
  const key = trackKey(index);
  const name = profile.name.trim() || `Track ${index + 1}`;
  const description = profile.description.trim();
  const prose = description
    ? description.length > MAX_TRACK_DESCRIPTION_CHARS
      ? `${description.slice(0, MAX_TRACK_DESCRIPTION_CHARS)}...[truncated]`
      : description
    : "(no description written — judge from the keywords alone, and be conservative: an empty description is not permission to be generous.)";

  const lines = [`${index + 1}. ${key} — ${name}`, `   ${prose}`];

  if (profile.keywords.length > 0) {
    lines.push(`   Signals they listed: ${list(profile.keywords, "none")}`);
  }
  if (profile.excludeKeywords.length > 0) {
    lines.push(
      `   Deal-breakers FOR THIS TRACK ONLY: ${list(profile.excludeKeywords, "none")}`,
    );
  }
  return lines.join("\n");
}

function list(values: string[], fallback: string): string {
  const cleaned = values.map((v) => v.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(", ") : fallback;
}
