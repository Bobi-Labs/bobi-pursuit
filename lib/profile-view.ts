/**
 * Reading a score *through* the user's current tracks.
 *
 * Every score in this app is keyed by profile id, and a profile id is a thing
 * the user can rename, reorder or delete between one render and the next. Three
 * rules fall out of that, and this module is where they live so no screen has to
 * remember them:
 *
 *  1. **Walk `settings.profiles`, never `score.profileScores`.** The tracks that
 *     exist are the tracks the user has now. A key left behind by a deleted
 *     track must never win "best fit", and a track added after a job was scored
 *     must show up as an honest "not assessed" rather than silently vanishing.
 *  2. **An orphan id may not crash a render.** `reconcileScoreToProfiles()`
 *     prunes them on every rescore, but a hand-edited import (or a document
 *     restored from a colleague's export) can still carry one. It renders as a
 *     dimmed "removed track" — visible, inert, unmistakably not a judgement.
 *  3. **A track's colour comes from the track.** `Profile.tone` is user-owned,
 *     so the same track reads the same on the card, the chip and the studio row.
 *
 * Pure functions, no React, no browser globals — safe under prerendering.
 */

import type { Job, JobScore, Profile } from "@/lib/types";
import { PROFILE_MATCH_THRESHOLD } from "@/lib/types";

/**
 * The tone vocabulary a badge can be asked for. `Profile["tone"]` is the set a
 * user can choose; `"muted"` is reserved for the app's own "this is not a track
 * any more" state, which is why it is not choosable.
 */
export type BadgeTone = Profile["tone"] | "muted";

/** Everything a badge needs to render a track it may or may not still have. */
export interface TrackLabel {
  id: string;
  name: string;
  short: string;
  tone: BadgeTone;
  /** True when the id no longer resolves to a track the user has. */
  removed: boolean;
}

/** One row of the per-track breakdown. */
export interface TrackRow extends TrackLabel {
  fit: number;
  reasoning: string;
  /** At or above `PROFILE_MATCH_THRESHOLD`. */
  matched: boolean;
  /** The score's `bestProfile`. At most one row is `true`. */
  best: boolean;
}

export function findProfile(profiles: Profile[], id: string): Profile | null {
  return profiles.find((profile) => profile.id === id) ?? null;
}

/** Resolve an id to a label, or to the "removed track" placeholder. */
export function trackLabel(profiles: Profile[], id: string): TrackLabel {
  const profile = findProfile(profiles, id);
  if (!profile) {
    return { id, name: "Removed track", short: "removed", tone: "muted", removed: true };
  }
  return {
    id: profile.id,
    name: profile.name,
    short: profile.short,
    tone: profile.tone,
    removed: false,
  };
}

/**
 * The breakdown, in the user's own track order, with any orphan keys appended
 * and flagged. Returns `[]` for an unscored job — callers render their own
 * "not scored yet", which is a different sentence from "scored zero".
 */
export function trackRows(score: JobScore | null, profiles: Profile[]): TrackRow[] {
  if (!score) return [];

  const rows: TrackRow[] = profiles.map((profile) => {
    const entry = score.profileScores[profile.id];
    const fit = entry ? entry.fit : 0;
    return {
      id: profile.id,
      name: profile.name,
      short: profile.short,
      tone: profile.tone,
      removed: false,
      fit,
      reasoning: entry?.reasoning ?? "not assessed for this track",
      matched: fit >= PROFILE_MATCH_THRESHOLD,
      best: score.bestProfile === profile.id,
    };
  });

  const known = new Set(profiles.map((profile) => profile.id));
  for (const [id, entry] of Object.entries(score.profileScores)) {
    if (known.has(id)) continue;
    rows.push({
      ...trackLabel(profiles, id),
      fit: entry.fit,
      reasoning: entry.reasoning,
      matched: false,
      best: false,
    });
  }

  return rows;
}

/** Badges for a card: the tracks this job matched, best first, orphans included. */
export function matchedLabels(
  score: JobScore | null,
  profiles: Profile[],
): TrackLabel[] {
  if (!score) return [];
  return score.matchedProfiles.map((id) => trackLabel(profiles, id));
}

/** The winning track, or `null` when nothing cleared the match threshold. */
export function bestLabel(
  score: JobScore | null,
  profiles: Profile[],
): TrackLabel | null {
  if (!score || !score.bestProfile) return null;
  return trackLabel(profiles, score.bestProfile);
}

/* ───────────────────────────── Aggregates ───────────────────────────── */

export interface TrackDistribution extends TrackLabel {
  /** Jobs whose score cleared this track's threshold. */
  matched: number;
  /** Mean fit for this track across every scored job. Rounded. */
  average: number;
  /** The best single fit this track has seen. */
  best: number;
}

/**
 * Per-track distribution across the board — the "where are my fits actually
 * coming from" readout on Overview.
 *
 * Counts against `profileScores`, not `matchedProfiles`, so a job that matched
 * two tracks is counted once for each. That is the honest reading: the question
 * is "how much of what I capture is contract work", not "which bucket did the
 * argmax land in".
 */
export function trackDistribution(
  jobs: Job[],
  profiles: Profile[],
): TrackDistribution[] {
  return profiles.map((profile) => {
    let matched = 0;
    let total = 0;
    let scored = 0;
    let best = 0;
    for (const job of jobs) {
      const entry = job.score?.profileScores[profile.id];
      if (!entry) continue;
      scored += 1;
      total += entry.fit;
      if (entry.fit > best) best = entry.fit;
      if (entry.fit >= PROFILE_MATCH_THRESHOLD) matched += 1;
    }
    return {
      id: profile.id,
      name: profile.name,
      short: profile.short,
      tone: profile.tone,
      removed: false,
      matched,
      average: scored === 0 ? 0 : Math.round(total / scored),
      best,
    };
  });
}

/** `["typescript", "react"]` → `"typescript, react"`. The list form users type. */
export function joinList(list: string[]): string {
  return list.join(", ");
}

/** The inverse. Lowercased and de-duplicated — keywords are matched case-insensitively. */
export function splitList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const term = raw.trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}
