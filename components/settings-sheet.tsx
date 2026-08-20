"use client";

/**
 * Settings — what you are looking for, who you are, and everything that can be
 * done to your data.
 *
 * The order is the argument. **Tracks come first**, because they are the product:
 * three hardcoded profiles used to live in the source, which meant a designer, a
 * nurse and a data engineer all got the same three meaningless buckets. Now the
 * buckets are data, they are yours, and they are the first thing you see.
 *
 * Below that: your rate and eligibility (facts about the person, not the track),
 * the optional API key, and the local-first contract made operable — export,
 * import, seed, wipe. A tool that keeps your data on your machine but gives you
 * no way to get it *off* your machine has not really given you anything.
 *
 * Two implementation notes worth keeping:
 *
 *  - **The text inputs are uncontrolled** (`defaultValue` + commit on blur).
 *    Committing on every keystroke would rescore the whole board while you are
 *    still halfway through typing "typescript", and a controlled mirror of store
 *    state is how the previous version grew a stale-closure bug that silently
 *    reverted edits. The DOM is the draft; blur is the commit.
 *  - `formKey` remounts the whole form after a clear or an import, which is the
 *    one moment uncontrolled inputs would otherwise keep showing the old values.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import {
  LLM_MODEL,
  estimateCostUsd,
  isLlmScore,
  scoreJobsWithClaude,
  testApiKey,
} from "@/lib/scoring/llm-scorer";
import { FTE_HOURS_PER_YEAR } from "@/lib/scoring/rule-scorer";
import { joinList, splitList } from "@/lib/profile-view";
import {
  ensureFilePermission,
  pickPursuitFile,
  suggestFileName,
} from "@/lib/store/adapters/file-system";
import { store } from "@/lib/store/store";
import { usePipeline, useStoreStatus } from "@/lib/store/use-pipeline";
import {
  COLOR_TONES,
  MAX_PROFILES,
  MIN_PROFILES,
  PROFILE_PRESETS,
  isColorTone,
  type Profile,
} from "@/lib/types";

import {
  Button,
  ColorBadge,
  Field,
  HintCard,
  INPUT,
  SectionLabel,
  Sheet,
  cx,
  type Tone,
} from "./ui";

/** Live state of a bulk run. `null` when nothing is running. */
interface BulkState {
  done: number;
  total: number;
  failed: number;
}

type Notice = { tone: Tone; text: string } | null;

const NOTICE_CLASS: Record<string, string> = {
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  red: "border-red-500/30 bg-red-500/10 text-red-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  muted: "border-border bg-card text-muted-foreground",
};

export function SettingsSheet({
  onClose,
  /**
   * Called after "delete everything", and required rather than optional: a wipe
   * that only empties the store leaves the shell still believing you are a
   * returning user. What that costs is documented at the call site and at
   * `handleWipe` in `pipeline-app.tsx`.
   */
  onWipe,
  focusKey = false,
}: {
  onClose: () => void;
  onWipe: () => void;
  /**
   * Opened from "Add a Claude key" rather than from the Settings button, so
   * land on the key field instead of at the top of a long sheet.
   *
   * Scrolls and focuses rather than only focusing: this input lives far down
   * past the tracks, and a focused control the reader cannot see is a worse
   * outcome than no focus at all — the page looks unchanged and the next
   * keystroke goes somewhere invisible.
   */
  focusKey?: boolean;
}) {
  const doc = usePipeline();
  const settings = doc.settings;
  const status = useStoreStatus();

  const [notice, setNotice] = useState<Notice>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [fileSync, setFileSync] = useState(false);
  const [testing, setTesting] = useState(false);
  const [bulk, setBulk] = useState<BulkState | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [openTrack, setOpenTrack] = useState<string | null>(
    settings.profiles.length === 1 ? settings.profiles[0].id : null,
  );
  const [presetKey, setPresetKey] = useState(PROFILE_PRESETS[0].key);

  // `fileSyncSupported` reads `window`. This sheet only ever mounts after a
  // click — long past hydration — but reading it in an effect keeps the rule
  // ("no browser globals during render") true without exceptions to remember.
  useEffect(() => {
    setFileSync(store.fileSyncSupported);
  }, []);

  /* ── in-flight API work ──
     One controller for whatever is running. Aborted on unmount, so closing the
     sheet mid-run stops spending the user's money rather than continuing
     invisibly against a component that no longer exists. */
  const abortRef = useRef<AbortController | null>(null);

  // The notice banner lives at the top of the sheet, but the actions that
  // produce one sit far enough down that in a scrolled panel the feedback lands
  // off-screen and the button reads as dead. (Observed exactly that: a rejected
  // key rendered a perfectly good 401 message the user could never see.)
  const noticeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (notice) {
      noticeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [notice]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const keyRef = useRef<HTMLInputElement>(null);
  const keySet = settings.anthropicApiKey.trim() !== "";
  const annualMode = settings.rateMode === "annual";
  // Rounded to the nearest 1000 going out, so a 75/hr target reads as 156,000
  // rather than 156,000.0000001 after a round trip through the divisor.
  const displayRate = annualMode
    ? Math.round((settings.targetHourlyRate * FTE_HOURS_PER_YEAR) / 1000) * 1000
    : settings.targetHourlyRate;

  // Deliberately not a layout effect: the sheet animates in, and scrolling
  // before it has a height lands at the top of a box that is still growing.
  useEffect(() => {
    if (!focusKey) return;
    const t = window.setTimeout(() => {
      const el = keyRef.current;
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.focus();
    }, 120);
    return () => window.clearTimeout(t);
  }, [focusKey]);
  const llmScored = useMemo(
    () => doc.jobs.filter((job) => isLlmScore(job.score)).length,
    [doc.jobs],
  );
  const pendingLlm = doc.jobs.length - llmScored;

  /* ── tracks ── */

  function addTrack() {
    const added = store.addProfileFromPreset(presetKey);
    if (!added) {
      setNotice({
        tone: "amber",
        text: `Five tracks is the ceiling. Remove one first — or widen an existing description instead, which usually works better than a fourth near-duplicate.`,
      });
      return;
    }
    setOpenTrack(added.id);
    setNotice({
      tone: "green",
      text: `Added “${added.name}”. Every job on the board has been scored against it.`,
    });
  }

  function removeTrack(profile: Profile) {
    if (!store.removeProfile(profile.id)) {
      setNotice({
        tone: "amber",
        text: "That is your only track — with none, every job would score a flat zero. Edit this one instead.",
      });
      return;
    }
    if (openTrack === profile.id) setOpenTrack(null);
    setNotice({
      tone: "muted",
      text: `Removed “${profile.name}”. Jobs Claude scored keep their other tracks' judgements.`,
    });
  }

  /* ── AI scoring ── */

  function commitKey() {
    store.updateSettings({ anthropicApiKey: keyRef.current?.value.trim() ?? "" });
  }

  async function runTestKey() {
    const key = keyRef.current?.value.trim() ?? "";
    commitKey();
    setTesting(true);
    setNotice(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await testApiKey(key, controller.signal);
    abortRef.current = null;
    setTesting(false);
    setNotice(
      result.ok
        ? { tone: "green", text: `That key works. Scoring will use ${LLM_MODEL}.` }
        : { tone: "red", text: result.message },
    );
  }

  function removeKey() {
    if (keyRef.current) keyRef.current.value = "";
    store.updateSettings({ anthropicApiKey: "" });
    setNotice({
      tone: "muted",
      text: "Key removed from this browser. Scoring falls back to rules.",
    });
  }

  /**
   * Bulk scoring. Only ever touches jobs that do NOT already hold an LLM score —
   * re-scoring something the user already paid for is spending their money to
   * get the same answer.
   */
  async function scoreAllWithClaude() {
    const snapshot = store.getSnapshot();
    const targets = snapshot.jobs.filter((job) => !isLlmScore(job.score));
    if (targets.length === 0) {
      setNotice({ tone: "amber", text: "Every job already has a Claude score." });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setNotice(null);
    setBulk({ done: 0, total: targets.length, failed: 0 });

    const summary = await scoreJobsWithClaude(targets, snapshot.settings, {
      onScored: (id, score) => store.setScore(id, score),
      onProgress: (p) => setBulk({ done: p.done, total: p.total, failed: p.failed }),
      signal: controller.signal,
    });

    abortRef.current = null;
    setBulk(null);

    if (summary.cancelled) {
      setNotice({
        tone: "amber",
        text: `Stopped. ${summary.scored} job${summary.scored === 1 ? "" : "s"} scored before you cancelled — those are kept.`,
      });
      return;
    }
    if (summary.error) {
      setNotice({
        tone: summary.scored > 0 ? "amber" : "red",
        text: `${summary.scored} scored, ${summary.failed} failed. ${summary.error.message}`,
      });
      return;
    }
    setNotice({
      tone: "green",
      text: `Scored ${summary.scored} job${summary.scored === 1 ? "" : "s"} with ${LLM_MODEL}.`,
    });
  }

  /* ── data ── */

  function exportJson() {
    const blob = new Blob([store.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = suggestFileName(settings.profileName || "pipeline");
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking in the same tick cancels the download in some engines.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice({
      tone: "green",
      text: `Downloaded ${link.download}. Your API key is never included.`,
    });
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0] ?? null;
    // Reset first, so picking the same file twice still fires a change event.
    input.value = "";
    if (!file) return;

    let text: string;
    try {
      text = await file.text();
    } catch {
      setNotice({ tone: "red", text: "That file could not be read." });
      return;
    }

    const result = store.importJson(text);
    if (!result.ok) {
      setNotice({ tone: "red", text: result.error ?? "That file could not be imported." });
      return;
    }
    setFormKey((k) => k + 1);
    setNotice({
      tone: result.imported > 0 ? "green" : "amber",
      text:
        result.imported > 0
          ? `Imported ${result.imported} job${result.imported === 1 ? "" : "s"}. Nothing you already had was touched.`
          : "Nothing new — every job in that file was already on your board.",
    });
  }

  async function attachFile() {
    try {
      const handle = await pickPursuitFile(settings.profileName || "pipeline");
      if (!handle) return; // cancelled, or no File System Access API
      const permission = await ensureFilePermission(handle);
      if (permission !== "granted") {
        setNotice({ tone: "amber", text: "That file was not granted write access." });
        return;
      }
      await store.attachFile(handle);
      setNotice({
        tone: "green",
        text: "Now mirroring every save into that file, for this browser session.",
      });
    } catch (e) {
      setNotice({
        tone: "red",
        text: e instanceof Error ? e.message : "Could not attach that file.",
      });
    }
  }

  const attached = status.adapterId.includes("fsa");
  const atCeiling = settings.profiles.length >= MAX_PROFILES;

  return (
    <Sheet
      open
      title="Settings"
      subtitle="What you are looking for, who you are, and where your data lives."
      width="sm:max-w-2xl"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-muted-foreground">
            {status.adapterLabel}
          </span>
          <Button size="md" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div key={formKey} className="space-y-5">
        {notice ? (
          <div
            ref={noticeRef}
            role="status"
            aria-live="polite"
            className={cx(
              "sticky top-0 z-10 rounded-md border px-2.5 py-2 text-[14px] leading-snug",
              NOTICE_CLASS[notice.tone] ?? NOTICE_CLASS.muted,
            )}
          >
            {notice.text}
          </div>
        ) : null}

        {/* ── tracks: the product ── */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>What you&apos;re looking for</SectionLabel>
            <span className="mb-2 font-mono text-[12px] text-text-muted">
              {settings.profiles.length}/{MAX_PROFILES}
            </span>
          </div>
          {/* The one hint this half of the sheet gets. Nothing below it can be
              read by someone who has not understood the word "track", so this is
              the paragraph worth the glow; the explanations under You and AI
              scoring stay grey on purpose, because a second warm card in the
              same view would halve this one (see HintCard). */}
          <HintCard title="What a track is">
            One kind of work you would actually take. Every job is scored against
            each track separately, because a posting worth 90 for contract work
            can be a 20 for a salaried role and one averaged number would hide
            that. Editing a track rescores the board immediately.
          </HintCard>

          <div className="space-y-2">
            {settings.profiles.map((profile, index) => (
              <TrackEditor
                key={profile.id}
                profile={profile}
                index={index}
                total={settings.profiles.length}
                open={openTrack === profile.id}
                onToggle={() =>
                  setOpenTrack((current) =>
                    current === profile.id ? null : profile.id,
                  )
                }
                onRemove={() => removeTrack(profile)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <select
              className={cx(INPUT, "w-auto max-w-full flex-1")}
              value={presetKey}
              onChange={(e) => setPresetKey(e.target.value)}
              disabled={atCeiling}
            >
              {PROFILE_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
            </select>
            <Button size="md" onClick={addTrack} disabled={atCeiling}>
              + Add track
            </Button>
          </div>
          {atCeiling ? (
            <p className="text-[14px] text-text-muted">
              Five is the ceiling. Past that the tracks stop discriminating and
              everything matches something.
            </p>
          ) : null}
        </section>

        {/* ── the person ── */}
        <section className="space-y-3 border-t border-border pt-5">
          <SectionLabel>You</SectionLabel>

          <Field label="Name" hint="Only used to name your export file.">
            <input
              className={INPUT}
              defaultValue={settings.profileName}
              onBlur={(e) => store.updateSettings({ profileName: e.target.value })}
              placeholder="Alex Rivera"
            />
          </Field>

          <Field
            label="Bio"
            hint="Not read by the rule scorer at all. With an Anthropic key set, this paragraph is what Claude is told about you before it judges a posting — which makes it the highest-leverage field on this screen the moment you add a key."
          >
            <textarea
              className={cx(INPUT, "min-h-[92px] resize-y leading-relaxed")}
              defaultValue={settings.bio}
              onBlur={(e) => store.updateSettings({ bio: e.target.value })}
              placeholder="Ten years shipping fintech and marketplace products; last three as a hands-on PM in payments…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Rate, in whichever unit the user thinks in.
                A job seeker looking at salaried roles does not know their hourly
                rate and should not have to divide by 2080 to use this field —
                and the scorer never needed them to: it already compares annual
                figures by converting the hourly target itself. So this is a
                display unit, not a second stored number. The input is keyed on
                the mode because it is uncontrolled: without the key, switching
                units would leave the old figure sitting in the box. */}
            <Field
              label={annualMode ? "Target salary (USD/yr)" : "Target rate (USD/hr)"}
              hint="Budgets are judged against this, on every track."
            >
              <div className="flex gap-1.5">
                <input
                  key={settings.rateMode}
                  className={cx(INPUT, "font-mono")}
                  defaultValue={String(displayRate)}
                  inputMode="numeric"
                  onBlur={(e) => {
                    const parsed = Number.parseFloat(
                      e.target.value.replace(/[, ]/g, ""),
                    );
                    if (!Number.isFinite(parsed) || parsed <= 0) {
                      // Reject rather than store a zero — a target of 0 makes
                      // every budget "fair" and quietly breaks the money signals.
                      e.target.value = String(displayRate);
                      return;
                    }
                    store.updateSettings({
                      targetHourlyRate: Math.max(
                        1,
                        Math.round(
                          annualMode ? parsed / FTE_HOURS_PER_YEAR : parsed,
                        ),
                      ),
                    });
                  }}
                  placeholder={annualMode ? "156000" : "75"}
                />
                <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
                  {(["hourly", "annual"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => store.updateSettings({ rateMode: mode })}
                      className={cx(
                        "px-2.5 py-2 text-[12px] font-semibold transition-colors",
                        settings.rateMode === mode
                          ? "bg-primary/15 text-primary"
                          : "bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {mode === "hourly" ? "/hr" : "/yr"}
                    </button>
                  ))}
                </div>
              </div>
            </Field>
            <Field
              label="Eligible locations"
              hint="A required location outside these caps a job at 25, whatever else it scores."
            >
              <input
                className={INPUT}
                defaultValue={joinList(settings.eligibleLocations)}
                onBlur={(e) =>
                  store.updateSettings({
                    eligibleLocations: splitList(e.target.value),
                  })
                }
                placeholder="remote, eu, uk, us"
              />
            </Field>
          </div>
        </section>

        {/* ── AI scoring ──
            The one place this app can cost money, so it states the trade-off in
            full — what changes, what it costs, where the key lives — before
            offering the button. */}
        <section className="space-y-3 border-t border-border pt-5">
          <div className="flex items-center gap-2">
            <SectionLabel>AI scoring</SectionLabel>
            <span className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              optional
            </span>
          </div>

          <p className="text-[14px] leading-relaxed text-muted-foreground">
            With no key, scoring matches your{" "}
            <span className="font-semibold text-foreground">keywords</span>:
            instant, free, fully transparent — and literal, because it matches
            words. Add your own Anthropic key and each job is read by{" "}
            <span className="font-mono text-foreground">{LLM_MODEL}</span>{" "}
            against your{" "}
            <span className="font-semibold text-foreground">description</span>{" "}
            instead, which is what understands “a seat close to engineering” when
            the posting never says those words. Costs {estimateCostUsd(1)} per
            job, billed to you by Anthropic. Nothing here is a subscription and
            nothing is billed by us.
          </p>

          <Field
            label="Anthropic API key"
            hint="Stored only in this browser, next to your jobs, and sent only to api.anthropic.com — there is no server here to send it to. It is never written into an export, so a backup or a shared file cannot leak it. Anyone who can use this browser profile can use this key."
          >
            <input
              ref={keyRef}
              className={cx(INPUT, "font-mono")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              defaultValue={settings.anthropicApiKey}
              onBlur={commitKey}
              placeholder="sk-ant-…"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="md" onClick={runTestKey} disabled={testing}>
              {testing ? "Testing…" : "Test key"}
            </Button>
            {keySet ? (
              <Button size="md" onClick={removeKey}>
                Remove key
              </Button>
            ) : null}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer noopener"
              className="text-[12px] text-primary transition-colors hover:underline"
            >
              Get a key at console.anthropic.com ↗
            </a>
          </div>

          {keySet && doc.jobs.length > 0 ? (
            <div className="rounded-[10px] border border-border bg-card/50 p-3">
              {bulk ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-semibold">
                      Scoring with Claude…
                    </span>
                    <span className="font-mono text-[12px] text-muted-foreground">
                      {bulk.done} / {bulk.total}
                    </span>
                  </div>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{
                        width: `${bulk.total === 0 ? 0 : Math.round((bulk.done / bulk.total) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[14px] text-muted-foreground">
                      {bulk.failed > 0 ? `${bulk.failed} failed · ` : ""}
                      Jobs already scored are kept if you stop.
                    </span>
                    <Button size="sm" onClick={() => abortRef.current?.abort()}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-semibold">
                      Score all with Claude
                    </span>
                    {llmScored > 0 ? (
                      <ColorBadge tone="purple">
                        <span className="font-mono">{llmScored}</span> already
                        AI-scored
                      </ColorBadge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
                    {pendingLlm === 0 ? (
                      "Every job already has a Claude score. Nothing to do, nothing to spend."
                    ) : (
                      <>
                        <span className="font-mono text-foreground">
                          {pendingLlm}
                        </span>{" "}
                        job{pendingLlm === 1 ? "" : "s"} have no Claude score yet
                        —{" "}
                        <span className="text-foreground">
                          {estimateCostUsd(pendingLlm)}
                        </span>
                        , three at a time. Jobs Claude has already scored are
                        skipped. Keep this panel open while it runs.
                      </>
                    )}
                  </p>
                  <div className="mt-2.5">
                    <Button
                      size="md"
                      variant="primary"
                      disabled={pendingLlm === 0}
                      onClick={scoreAllWithClaude}
                    >
                      Score {pendingLlm} job{pendingLlm === 1 ? "" : "s"} ·{" "}
                      {estimateCostUsd(pendingLlm)}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </section>

        {/* ── data ── */}
        <section className="space-y-3 border-t border-border pt-5">
          <SectionLabel>Your data</SectionLabel>
          {/* The second and last hint. Local-first is a promise and a liability
              in the same sentence, and the liability half is the one people
              discover after the board is already gone — so it is stated where
              the export button can still do something about it. */}
          <HintCard title="No server, no backup">
            Everything stays in this browser: jobs, tracks, and your key. There
            is no account and no server, so nothing is backed up anywhere else.
            An export is the backup, and clearing your browser data clears all
            of it.
          </HintCard>

          <div className="flex flex-wrap gap-1.5">
            <Button size="md" onClick={exportJson}>
              ↓ Export JSON
            </Button>
            <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
              ↑ Import JSON
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={importJson}
              />
            </label>
            <Button
              size="md"
              onClick={() => {
                const imported = store.loadSample();
                setNotice({
                  tone: imported > 0 ? "green" : "amber",
                  text:
                    imported > 0
                      ? `Sample pipeline loaded — ${imported} illustrative job${imported === 1 ? "" : "s"}, scored against your tracks.`
                      : "Nothing new — the sample pipeline is already on your board.",
                });
              }}
            >
              Load sample data
            </Button>
            <Button
              size="md"
              onClick={() => {
                store.rescoreAll();
                setNotice({
                  tone: "green",
                  text:
                    llmScored > 0
                      ? `Rule-scored jobs re-judged against your current tracks. ${llmScored} Claude-scored job${llmScored === 1 ? "" : "s"} left alone.`
                      : "Every job rescored against your current tracks.",
                });
              }}
            >
              ↻ Rescore everything
            </Button>
          </div>

          {/* Only offered when there is something to lose. Replacing an LLM score
              with a rules score is a downgrade the user paid for, so it is never
              what the plain "rescore" button does. */}
          {llmScored > 0 ? (
            <p className="text-[14px] leading-relaxed text-text-muted">
              Rescoring skips the {llmScored} job{llmScored === 1 ? "" : "s"}{" "}
              Claude scored — a rules pass would be a downgrade.{" "}
              <button
                type="button"
                className="font-semibold text-muted-foreground underline transition-colors hover:text-foreground"
                onClick={() => {
                  store.rescoreAll(true);
                  setNotice({
                    tone: "amber",
                    text: `Replaced ${llmScored} Claude score${llmScored === 1 ? "" : "s"} with rule scores. Scoring them again costs money.`,
                  });
                }}
              >
                Replace those too
              </button>
              .
            </p>
          ) : null}

          {fileSync ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {attached ? (
                <Button
                  size="md"
                  onClick={() => {
                    store.detachFile();
                    setNotice({
                      tone: "muted",
                      text: "Stopped mirroring to a file. Your browser copy is untouched.",
                    });
                  }}
                >
                  Stop saving to file
                </Button>
              ) : (
                <Button size="md" onClick={attachFile}>
                  Also save to a file…
                </Button>
              )}
              <span className="text-[14px] text-text-muted">
                Optional mirror. Browsers forget file permission on reload, so
                this lasts one session.
              </span>
            </div>
          ) : null}
        </section>

        {/* ── destruction ── */}
        <section className="space-y-2 border-t border-border pt-5">
          <SectionLabel>Danger zone</SectionLabel>
          {confirmClear ? (
            <div className="rounded-[10px] border border-red-500/30 bg-red-500/[0.07] p-3">
              <p className="text-[14px] leading-relaxed text-red-200">
                This deletes every job and resets your tracks, here and in this
                browser&apos;s storage. There is no undo and no copy on a server.
                Export first if you might want it back.
              </p>
              <div className="mt-2.5 flex gap-1.5">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    store.clearAll();
                    setConfirmClear(false);
                    setOpenTrack(null);
                    setFormKey((k) => k + 1);
                    setNotice({ tone: "amber", text: "Everything cleared." });
                    // Last, and not optional: the store wipes the document, but
                    // "have you been here before" is answered by state the store
                    // has never heard of — the shell's first-run latch and the
                    // tour-seen flag. Without this the app comes back empty and
                    // still convinced you are a returning user, which is how a
                    // from-scratch run lost its setup and its tour. The shell
                    // closes this sheet in response.
                    onWipe();
                  }}
                >
                  Yes, delete everything
                </Button>
                <Button size="sm" onClick={() => setConfirmClear(false)}>
                  Keep my data
                </Button>
              </div>
            </div>
          ) : (
            <Button size="md" variant="danger" onClick={() => setConfirmClear(true)}>
              Clear everything
            </Button>
          )}
        </section>
      </div>
    </Sheet>
  );
}

/* ─────────────────────────────── Track editor ─────────────────────────────── */

/**
 * One track, collapsed to a summary row until you open it.
 *
 * Inputs are uncontrolled and commit on blur — see the file header. `id` is not
 * editable and never rendered: it is what keeps every existing score resolving
 * when you rename the thing.
 */
function TrackEditor({
  profile,
  index,
  total,
  open,
  onToggle,
  onRemove,
}: {
  profile: Profile;
  index: number;
  total: number;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cx(
        "rounded-[10px] border transition-colors",
        open ? "border-primary/40 bg-card" : "border-border bg-card/50",
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span className="font-mono text-[12px] text-text-muted">
            {open ? "▾" : "▸"}
          </span>
          <ColorBadge tone={profile.tone}>{profile.short}</ColorBadge>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {profile.name}
          </span>
          <span className="shrink-0 font-mono text-[12px] text-text-muted">
            {profile.keywords.length} kw
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-0.5">
          <Button
            size="xs"
            variant="ghost"
            title="Move up — order breaks ties between equal scores"
            disabled={index === 0}
            onClick={() => store.moveProfile(profile.id, -1)}
          >
            ▲
          </Button>
          <Button
            size="xs"
            variant="ghost"
            title="Move down"
            disabled={index === total - 1}
            onClick={() => store.moveProfile(profile.id, 1)}
          >
            ▼
          </Button>
          <Button
            size="xs"
            variant="ghost"
            title={
              total <= MIN_PROFILES
                ? "You need at least one track"
                : "Remove this track"
            }
            disabled={total <= MIN_PROFILES}
            onClick={onRemove}
          >
            ✕
          </Button>
        </span>
      </div>

      {open ? (
        <div className="space-y-3 border-t border-border px-2.5 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px_120px]">
            <Field label="Name">
              <input
                className={INPUT}
                defaultValue={profile.name}
                onBlur={(e) =>
                  store.updateProfile(profile.id, { name: e.target.value })
                }
                placeholder="Contract dev work"
              />
            </Field>
            <Field label="Badge" hint="≤10 chars.">
              <input
                className={INPUT}
                maxLength={10}
                defaultValue={profile.short}
                onBlur={(e) =>
                  store.updateProfile(profile.id, { short: e.target.value })
                }
                placeholder="Contract"
              />
            </Field>
            <Field label="Colour">
              <select
                className={INPUT}
                defaultValue={profile.tone}
                onChange={(e) => {
                  const tone = e.target.value;
                  if (isColorTone(tone)) store.updateProfile(profile.id, { tone });
                }}
              >
                {COLOR_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="What you're looking for"
            hint="Prose, in your own words — the seniority, the shape of the engagement, the kind of team. The rule scorer only skims it for shared vocabulary; with an Anthropic key set, this is the whole judgement."
          >
            <textarea
              className={cx(INPUT, "min-h-[108px] resize-y leading-relaxed")}
              defaultValue={profile.description}
              onBlur={(e) =>
                store.updateProfile(profile.id, { description: e.target.value })
              }
              placeholder="Contract and freelance work I can bid on today: a defined build with a scope, a budget and an end date…"
            />
          </Field>

          <Field
            label="Keywords"
            hint="Comma-separated, matched literally. A hit in the title is worth more than one in the body."
          >
            <input
              className={INPUT}
              defaultValue={joinList(profile.keywords)}
              onBlur={(e) =>
                store.updateProfile(profile.id, {
                  keywords: splitList(e.target.value),
                })
              }
              placeholder="typescript, react, postgres"
            />
          </Field>

          <Field
            label="Deal-breakers"
            hint="Only for this track. “Full-time” is a deal-breaker for a one-off gig track and the entire point of a salaried one."
          >
            <input
              className={INPUT}
              defaultValue={joinList(profile.excludeKeywords)}
              onBlur={(e) =>
                store.updateProfile(profile.id, {
                  excludeKeywords: splitList(e.target.value),
                })
              }
              placeholder="unpaid, equity only, on-site only"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}
