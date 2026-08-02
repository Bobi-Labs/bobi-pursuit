"use client";

/**
 * First run.
 *
 * This screen is where the product is won or lost, so it does three things and
 * refuses to do a fourth:
 *
 *  1. **Ask what you are looking for, and make the answer good by default.** A
 *     blank prose box is a wall. The presets are real, specific, written as if a
 *     person wrote them — good enough to leave unedited, concrete enough to
 *     adjust. This step is the entire reason the app is not "three buckets from
 *     the maintainer's own job search".
 *  2. **Say how jobs get in**, including the part that is not flattering: there
 *     are no scrapers here, capture is a click you make.
 *  3. **Offer the key honestly** — what changes, what it costs, where it lives —
 *     and make skipping it the obvious, unpunished default.
 *
 * The fourth thing it refuses to do is trap you. Every step carries "just show
 * me", which loads the sample pipeline and gets out of the way.
 *
 * Nothing here touches storage during render: `profileFromPreset()` mints ids,
 * so it is only ever called from a click handler.
 */

import { useState } from "react";

import { testApiKey } from "@/lib/scoring/llm-scorer";
import { splitList, joinList } from "@/lib/profile-view";
import { store } from "@/lib/store/store";
import {
  MAX_PROFILES,
  PROFILE_PRESETS,
  profileFromPreset,
  type Profile,
  type ProfilePreset,
} from "@/lib/types";

import { CaptureRoutes } from "./how-it-works";
import { Button, ColorBadge, Field, HintCard, INPUT, PanelCard, cx } from "./ui";

interface Picked {
  /** Which preset it came from — the picker toggles on this, not on the id. */
  key: string;
  profile: Profile;
}

const STEPS = [
  { n: 1, label: "What you're after" },
  { n: 2, label: "Getting jobs in" },
  { n: 3, label: "How they're read" },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [keyNotice, setKeyNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const atCeiling = picked.length >= MAX_PROFILES;

  function toggle(preset: ProfilePreset) {
    setPicked((current) => {
      const existing = current.find((entry) => entry.key === preset.key);
      if (existing) return current.filter((entry) => entry.key !== preset.key);
      if (current.length >= MAX_PROFILES) return current;
      return [...current, { key: preset.key, profile: profileFromPreset(preset) }];
    });
  }

  function patch(key: string, patchProfile: Partial<Profile>) {
    setPicked((current) =>
      current.map((entry) =>
        entry.key === key
          ? { ...entry, profile: { ...entry.profile, ...patchProfile } }
          : entry,
      ),
    );
  }

  /** Replaces the starter track outright — this is the user's answer, not an addition. */
  function commitTracks() {
    if (picked.length === 0) return;
    store.updateSettings({ profiles: picked.map((entry) => entry.profile) });
  }

  function showMeTheSample() {
    commitTracks();
    store.loadSample();
    onDone();
  }

  async function runTestKey() {
    const key = apiKey.trim();
    if (!key) return;
    setTesting(true);
    setKeyNotice(null);
    const result = await testApiKey(key);
    setTesting(false);
    setKeyNotice(
      result.ok
        ? { ok: true, text: "That key works. Jobs will be read by Claude." }
        : { ok: false, text: result.message },
    );
  }

  function finish() {
    commitTracks();
    const key = apiKey.trim();
    if (key) store.updateSettings({ anthropicApiKey: key });
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      {/* ── header ── */}
      <div className="relative overflow-hidden border-b border-border px-4 pb-5 pt-6 sm:px-6">
        <div aria-hidden className="banner-mesh absolute inset-0" />
        <div aria-hidden className="banner-grid absolute inset-0 opacity-50" />
        <div className="relative mx-auto flex max-w-3xl flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
              Bobi Labs · local-first
            </div>
            <h1 className="text-2xl font-bold -tracking-[0.02em]">
              Bobi<span className="text-emerald-400">·</span>Pursuit
            </h1>
            <p className="mt-1 max-w-lg text-[14px] leading-relaxed text-muted-foreground">
              Three short steps and you have a job pipeline that scores what you
              capture against what you actually want. No account, no server,
              nothing uploaded — it all stays in this browser.
            </p>
          </div>
          {/* Skipping keeps whatever you already picked. Discarding a track
              someone just wrote as the price of leaving a wizard is rude. */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              commitTracks();
              onDone();
            }}
          >
            Skip setup ✕
          </Button>
        </div>
      </div>

      {/* ── step rail ── */}
      <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {STEPS.map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => setStep(s.n)}
              className={cx(
                "inline-flex items-center gap-2 text-[12px] font-medium transition-colors",
                step === s.n
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cx(
                  "grid h-5 w-5 place-items-center rounded-full border font-mono text-[12px] font-bold",
                  step === s.n
                    ? "border-primary bg-primary/15 text-primary"
                    : step > s.n
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-border text-muted-foreground",
                )}
              >
                {step > s.n ? "✓" : s.n}
              </span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── body ── */}
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-4 sm:px-6">
        {step === 1 ? (
          <StepTracks
            picked={picked}
            atCeiling={atCeiling}
            onToggle={toggle}
            onPatch={patch}
          />
        ) : null}
        {step === 2 ? <StepCapture /> : null}
        {step === 3 ? (
          <StepKey
            apiKey={apiKey}
            onKey={setApiKey}
            testing={testing}
            notice={keyNotice}
            onTest={runTestKey}
          />
        ) : null}
      </div>

      {/* ── footer ── */}
      <div className="sticky bottom-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
          <Button size="md" variant="ghost" onClick={showMeTheSample}>
            Just show me — load sample data
          </Button>
          <div className="flex items-center gap-1.5">
            {step > 1 ? (
              <Button size="md" onClick={() => setStep(step - 1)}>
                ← Back
              </Button>
            ) : null}
            {step < 3 ? (
              <Button
                size="md"
                variant="primary"
                onClick={() => {
                  if (step === 1) commitTracks();
                  setStep(step + 1);
                }}
              >
                {step === 1 && picked.length === 0
                  ? "Skip — use the default track →"
                  : "Continue →"}
              </Button>
            ) : (
              <Button size="md" variant="solid" onClick={finish}>
                Start capturing →
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Step 1 ─────────────────────────────── */

function StepTracks({
  picked,
  atCeiling,
  onToggle,
  onPatch,
}: {
  picked: Picked[];
  atCeiling: boolean;
  onToggle: (preset: ProfilePreset) => void;
  onPatch: (key: string, patch: Partial<Profile>) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-bold -tracking-[0.01em]">
        What are you looking for?
      </h2>

      {/* The argument for scoring tracks apart from each other used to be a
          paragraph stacked between the heading and the grid, which made it the
          first thing in the way and therefore the first thing skipped. Same
          argument, cut to the sentence that carries it, sitting where the eye
          already goes on the way to the presets instead of in front of them. */}
      <HintCard title="Separate scores">
        Pick up to {MAX_PROFILES}{" "}
        <span className="font-semibold">tracks</span> and edit them any time.
        Each is scored on its own: a posting that is a 90 for contract work is a
        20 for a salaried role, and one averaged number would hide exactly that.
      </HintCard>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PROFILE_PRESETS.map((preset) => {
          const on = picked.some((entry) => entry.key === preset.key);
          const disabled = !on && atCeiling;
          return (
            <button
              key={preset.key}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(preset)}
              aria-pressed={on}
              aria-label={preset.label}
              className={cx(
                "rounded-[10px] border p-3 text-left transition-colors",
                on
                  ? "border-primary/50 bg-primary/[0.07]"
                  : "border-border bg-card/50 hover:bg-muted/40",
                disabled && "cursor-not-allowed opacity-40",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[14px] font-semibold leading-snug">
                  {preset.label}
                </span>
                {/* The tick is *absent* when unselected, not merely invisible —
                    a transparent "✓" is still read out by a screen reader, and
                    every card announcing "✓" is worse than no tick at all. */}
                <span
                  aria-hidden
                  className={cx(
                    "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[11px] font-bold",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border",
                  )}
                >
                  {on ? "✓" : ""}
                </span>
              </div>
              <div className="mt-1 text-[14px] text-muted-foreground">
                {preset.blurb}
              </div>
            </button>
          );
        })}
      </div>

      {picked.length === 0 ? (
        <p className="text-[14px] leading-relaxed text-text-muted">
          Pick nothing and you get one broad software-engineering track to start
          from — fine for a look around, worth replacing before you trust a
          number.
        </p>
      ) : (
        <div className="space-y-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Make them yours
          </div>
          {picked.map((entry) => (
            <PanelCard key={entry.key}>
              <div className="mb-2.5 flex items-center gap-2">
                <ColorBadge tone={entry.profile.tone}>
                  {entry.profile.short || "track"}
                </ColorBadge>
                <span className="text-[14px] font-semibold">
                  {entry.profile.name}
                </span>
              </div>
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_130px]">
                  <Field label="Name">
                    <input
                      className={INPUT}
                      value={entry.profile.name}
                      onChange={(e) => onPatch(entry.key, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="Badge">
                    <input
                      className={INPUT}
                      maxLength={10}
                      value={entry.profile.short}
                      onChange={(e) =>
                        onPatch(entry.key, { short: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field
                  label="What you're looking for"
                  hint="Written for a person to read. With an Anthropic key set later, this paragraph is exactly what Claude judges a posting against."
                >
                  <textarea
                    className={cx(INPUT, "min-h-[110px] resize-y leading-relaxed")}
                    value={entry.profile.description}
                    onChange={(e) =>
                      onPatch(entry.key, { description: e.target.value })
                    }
                    placeholder="Describe the work you would actually say yes to…"
                  />
                </Field>
                <Field
                  label="Keywords"
                  hint="Comma-separated. These are what the free tier matches on, literally."
                >
                  <input
                    className={INPUT}
                    value={joinList(entry.profile.keywords)}
                    onChange={(e) =>
                      onPatch(entry.key, { keywords: splitList(e.target.value) })
                    }
                  />
                </Field>
              </div>
            </PanelCard>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── Step 2 ─────────────────────────────── */

function StepCapture() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[16px] font-bold -tracking-[0.01em]">
          How jobs get in
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
          By capture — a click on a posting you are already reading. The
          extension is the front door; the bookmarklet works everywhere; the add
          form is always there. Whichever you use, the job is scored on the way
          in and the same posting captured twice stays one card.
        </p>
      </div>

      {/* This step's one hint, and it goes on the missing feature rather than
          on the intro above: "no scrapers" is the line a reader assumes is a
          paywall, and only the technical reason answers that. It sits directly
          on top of the capture routes because it is the argument for them. */}
      <HintCard title="Not a paywall">
        There are no scrapers in this tier. A page running in your browser
        cannot fetch a job board&apos;s HTML, and the boards block datacenter
        IPs, so scraping needs a server this app deliberately does not have.
        Capture is the honest version: nothing reads a page until you click.
      </HintCard>

      <CaptureRoutes />
    </div>
  );
}

/* ─────────────────────────────── Step 3 ─────────────────────────────── */

function StepKey({
  apiKey,
  onKey,
  testing,
  notice,
  onTest,
}: {
  apiKey: string;
  onKey: (value: string) => void;
  testing: boolean;
  notice: { ok: boolean; text: string } | null;
  onTest: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[16px] font-bold -tracking-[0.01em]">
          Want it to actually read the jobs?
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
          Optional, and skipping it costs you nothing — the app is fully usable
          without a key. Here is the honest difference.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <PanelCard>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[14px] font-bold">Without a key</span>
            <ColorBadge tone="green">default</ColorBadge>
          </div>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            We match your <span className="font-semibold text-foreground">keywords</span>{" "}
            — literally, instantly, offline, and with every signal that moved the
            number written out so you can argue with it. It is genuinely useful
            and it is genuinely dumb: it cannot tell a “senior product designer”
            from “senior developer, product team”.
          </p>
        </PanelCard>
        <PanelCard className="border-violet-500/30 bg-violet-500/[0.05]">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[14px] font-bold">With your own key</span>
            <ColorBadge tone="purple">better</ColorBadge>
          </div>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            Claude reads the whole posting against the{" "}
            <span className="font-semibold text-foreground">description</span> you
            just wrote and produces its own reasoning for each track. Under $0.01
            a job, billed to you by Anthropic. The key is stored in this browser,
            sent only to api.anthropic.com, and stripped out of every export.
          </p>
        </PanelCard>
      </div>

      <Field
        label="Anthropic API key"
        hint="Optional. You can add or remove it later in Settings, and nothing else in this app makes a network request."
      >
        <input
          className={cx(INPUT, "font-mono")}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => onKey(e.target.value)}
          placeholder="sk-ant-…"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="md" onClick={onTest} disabled={testing || apiKey.trim() === ""}>
          {testing ? "Testing…" : "Test key"}
        </Button>
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer noopener"
          className="text-[14px] text-primary transition-colors hover:underline"
        >
          Get a key at console.anthropic.com ↗
        </a>
      </div>

      {notice ? (
        <div
          className={cx(
            "rounded-md border px-2.5 py-2 text-[14px] leading-snug",
            notice.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-300",
          )}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}
