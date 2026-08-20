"use client";

/**
 * First run.
 *
 * This screen is where the product is won or lost, so it does three things and
 * refuses to do a fourth:
 *
 *  1. **Ask what you are looking for, and make the answer good by default.** A
 *     blank prose box is a wall. The presets are real, specific, written as if a
 *     person wrote them — good enough to leave unedited, which is what this step
 *     now relies on: the per-track edit forms moved to Settings, because four
 *     text fields thirty seconds in is what made three screens feel like ten.
 *     This step is the entire reason the app is not "three buckets from the
 *     maintainer's own job search".
 *  2. **Say how jobs get in**, including the part that is not flattering: there
 *     are no scrapers here, capture is a click you make.
 *  3. **Offer the key honestly** — what changes, what it costs, where it lives —
 *     and make skipping it the obvious, unpunished default.
 *
 * The fourth thing it refuses to do is trap you. Every step carries "just show
 * me", which loads the sample pipeline and gets out of the way.
 *
 * ⚠️ **There is exactly one way out of this screen: `leave()`.** Three buttons
 * reach it — finish, "Skip setup" in the header, and the sample-data escape in
 * the footer — and none of them may call `onClose` directly. The parent hands
 * over to the first-run tour on close, and the version of this file that let
 * each exit call the callback itself is the shape that loses that handover the
 * moment a fourth exit is added. One funnel, one call site, and every exit
 * inherits whatever the parent decides to do next for free.
 *
 * Nothing here touches storage during render: `profileFromPreset()` mints ids,
 * so it is only ever called from a click handler.
 */

import { useEffect, useState } from "react";

import { testApiKey } from "@/lib/scoring/llm-scorer";
import { store } from "@/lib/store/store";
import {
  MAX_PROFILES,
  PROFILE_PRESETS,
  profileFromPreset,
  type Profile,
  type ProfilePreset,
} from "@/lib/types";

import { CaptureRoutes } from "./how-it-works";
import {
  Button,
  ColorBadge,
  Field,
  INPUT,
  MoreInfo,
  Steps,
  cx,
} from "./ui";

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

/**
 * `onClose` rather than `onDone`: the parent gets the same call whether you
 * finished, skipped, or bailed to the sample data, and a prop named for
 * completion is an invitation to wire only the completion path to it.
 */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  /* The welcome popup, above the wizard. See `WelcomeDialog` for why it is a
     dismissible box and not a screen you walk through. */
  const [welcome, setWelcome] = useState(true);
  /* Whether either store link has been CLICKED on step 2. Not whether an
     extension is installed — a page cannot know that — so nothing built on this
     may claim it. It only decides whether the forward button reads as a skip or
     as a continue. See the footer. */
  const [touchedPlugin, setTouchedPlugin] = useState(false);
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

  /** Replaces the starter track outright — this is the user's answer, not an addition. */
  function commitTracks() {
    if (picked.length === 0) return;
    store.updateSettings({ profiles: picked.map((entry) => entry.profile) });
  }

  /**
   * The only exit. `then` is whatever this particular door does on the way out,
   * and it runs *after* the tracks are committed on purpose: `loadSample()`
   * scores its jobs against whatever settings are live at the moment it runs, so
   * committing second would seed the board against the track the user just
   * replaced.
   *
   * Committing on every exit, including the skips, is also deliberate.
   * Discarding a track someone just wrote as the price of leaving a wizard is
   * rude.
   */
  function leave(then?: () => void) {
    commitTracks();
    then?.();
    onClose();
  }

  function showMeTheSample() {
    leave(() => store.loadSample());
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
    leave(() => {
      const key = apiKey.trim();
      if (key) store.updateSettings({ anthropicApiKey: key });
    });
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      {welcome ? <WelcomeDialog onClose={() => setWelcome(false)} /> : null}

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
            {/* One line. The previous three sentences argued the product's
                case at somebody who has not agreed to read anything yet — and
                every clause in it is already said better somewhere they will
                actually be: the welcome popup, or How it works. */}
            <p className="mt-1 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
              Welcome to Pursuit — your all-in-one job hunt lifecycle assistant.
            </p>
          </div>
          {/* Through `leave()` like every other exit — see the file header. This
              is the door a sceptical first-run user is most likely to take, so
              it is the one that must not skip the handover. */}
          <Button size="sm" variant="ghost" onClick={() => leave()}>
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
          />
        ) : null}
        {step === 2 ? (
          <StepCapture onInstallClick={() => setTouchedPlugin(true)} />
        ) : null}
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
      {/* `bg-card` flat below `sm`, blur only from there. A translucent sticky
          bar over a scrolling list is a known ghosting surface on iOS Safari:
          the blurred layer repaints out of step and paints a stale copy of the
          button beside the live one, which is exactly the doubled "Skip — use
          the default track" the operator photographed. Not reproducible on
          desktop Chrome, so this is a fix for the likeliest cause rather than
          one watched to work — it wants a look on his phone. The blur was
          decoration over an already-opaque bar; nothing is lost. */}
      <div className="sticky bottom-0 border-t border-border bg-card px-4 py-3 sm:bg-card/95 sm:px-6 sm:backdrop-blur">
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
              /* The forward button names what you are actually doing.
               *
               * On step 2 it reads "Get plugins later" and sits muted until one
               * of the store links is clicked, then becomes an ordinary green
               * "Continue". Nothing is blocked — it is never disabled — but a
               * greyed button that says "later" tells somebody skipping past the
               * plugin that they are skipping a component, which the identical
               * green Continue did not.
               *
               * ⚠️ It reflects a CLICK on the store link, never an install: a
               * page cannot see the user's extensions, so a version of this that
               * says "installed" would be lying on every person who opened the
               * store and closed it. */
              <Button
                size="md"
                variant={step === 2 && !touchedPlugin ? "default" : "primary"}
                className={
                  step === 2 && !touchedPlugin
                    ? "text-muted-foreground"
                    : undefined
                }
                onClick={() => {
                  if (step === 1) commitTracks();
                  setStep(step + 1);
                }}
              >
                {step === 1 && picked.length === 0
                  ? "Skip — use the default track →"
                  : step === 2 && !touchedPlugin
                    ? "Get plugins later →"
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

/* ───────────────────────────── Welcome popup ──────────────────────────── */

/**
 * Four lines, one button, gone.
 *
 * The problem it fixes: land on the bare link with no context and the first
 * thing the app does is ask "What are you looking for?" over twelve preset
 * tracks. Fine if you arrived from a post that explained the product, baffling
 * otherwise — which is most people.
 *
 * ⚠️ **Keep this small.** The first attempt answered the same problem with a
 * full explainer screen you walked through, and the operator's verdict was
 * exactly right: *"this is just 10x the noise it was."* A cold visitor needs one
 * sentence of orientation, not a landing page — the wizard behind this box is
 * already good at explaining itself once you know what "it" is. If a future
 * session finds itself adding a third paragraph here, that is the signal it has
 * started rebuilding the thing that got reverted.
 *
 * Not persisted anywhere. It rides inside first-run onboarding, so it shows on
 * the visit that opens the wizard and never again — no storage key, nothing to
 * migrate, and no way for it to reappear at someone already using the app.
 */
function WelcomeDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      // Clicking the dim closes it. The box below stops the bubble, so a click
      // that lands on the text does not dismiss what you are reading.
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-[16px] border border-emerald-500/30 bg-card p-6 shadow-[0_0_80px_-16px_rgba(16,185,129,0.55)] ring-1 ring-emerald-400/20"
      >
        <h2
          id="welcome-title"
          className="text-[24px] font-bold -tracking-[0.02em] text-foreground"
        >
          Welcome to Bobi<span className="text-emerald-400">·</span>Pursuit 👋
        </h2>
        <div className="mt-3 space-y-2.5 text-[16px] leading-relaxed text-foreground/90">
          <p>A web-based job hunt assistant and tracker.</p>
          <p>
            Use the browser plugin to save postings to your board, and track each
            one through applied, interviewing and offer.
          </p>
          <p>
            Save your job searches, find CV and interview resources, and keep the
            whole hunt in one place.
          </p>
          {/* ⚠️ This line said "a phone is fine for checking in" and that was
              simply untrue — the operator caught it. There is no sync and no
              account: the board is in ONE browser's local storage, so opening
              the app on a phone hands you a different, empty board. Export and
              import is the only bridge, and that is a migration, not a check-in.
              Say device, not just browser; "this browser" reads as "the app" to
              somebody who has not thought about where it lives. */}
          <p className="text-muted-foreground">
            Free, no account — everything saves in this browser, on this device
            only. Built for a desktop.
          </p>
        </div>
        <div className="mt-4 flex justify-end">
          {/* `autoFocus` rather than a ref: `Button` spreads its rest props
              onto the DOM node, so this needs no ref plumbing, and it puts the
              only control under Enter for a keyboard user. */}
          <Button autoFocus size="md" variant="solid" onClick={onClose}>
            Get started →
          </Button>
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
}: {
  picked: Picked[];
  atCeiling: boolean;
  onToggle: (preset: ProfilePreset) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-bold -tracking-[0.01em]">
        What are you looking for?
      </h2>

      {/* An instruction, not an explanation.
          This was a four-line argument for why tracks are scored separately —
          correct, and answering a question nobody has on the screen where they
          are being asked to click some boxes. The reasoning survives in How it
          works, where a person who wants it will look. */}
      <p className="text-[15px] text-muted-foreground">
        Pick up to {MAX_PROFILES} areas of expertise below.
      </p>

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

      {/* ⚠️ The per-track edit forms used to live here — name, badge, a prose
          description and a keyword list, one card per pick — and they are gone
          on purpose. Not because editing is unimportant: it is the single
          highest-value thing a user can do, and the reason the app is not "three
          buckets from the maintainer's own job search".

          They are gone because this is the door. Somebody who has clicked two
          checkboxes on their first thirty seconds with an unfamiliar tool has
          not earned four text fields, and the fields were what made a
          three-screen wizard feel like paperwork — the operator's tester said
          "too many steps" about a flow that has three. The presets are written
          to be good unedited; every one of these fields is in Settings, and the
          line below says so.

          If a future session is tempted to put them back: the edit surface is
          not missing, it is relocated. Adding it here again re-adds the wall. */}
      {picked.length === 0 ? (
        <p className="text-[14px] text-text-muted">
          Pick nothing and you start on a broad software-engineering track.
        </p>
      ) : (
        <p className="text-[14px] text-muted-foreground">
          You can edit these later in Settings.
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────── Step 2 ─────────────────────────────── */

function StepCapture({ onInstallClick }: { onInstallClick: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[16px] font-bold -tracking-[0.01em]">
          How jobs get in
        </h2>
        {/* The sequence replaces the paragraph that used to describe it. Three
            interchangeable routes stated as prose made the reader assemble the
            order themselves; one path stated as four boxes does not. The other
            two routes still exist immediately below in CaptureRoutes. */}
        <div className="mt-2.5">
          <Steps
            steps={[
              "Get the plugin",
              "Open a job post",
              "Click Add in the sidebar",
              "See it in Pipeline",
            ]}
          />
        </div>
      </div>

      {/* The "Not a paywall" explanation used to sit here, and it is gone
          rather than shortened.
          It was answering an objection nobody has yet. On step two of setup the
          reader has not looked for a scraper, not failed to find one, and not
          concluded they were being upsold — they are trying to get a job onto a
          board. Defending against a complaint before it exists spends the
          scarcest attention in the product on the app's anxiety rather than the
          user's task, and it stacked a second disclosure directly above the one
          in CaptureRoutes, which is what made the pair look mismatched.
          The full argument still lives in How it works, under "What it does not
          do", where somebody asking the question will actually be. */}
      <CaptureRoutes onInstallClick={onInstallClick} />
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
      </div>

      {/* Two paths, each as a row of steps, because the choice is between two
          sequences rather than between two paragraphs. The cost, the privacy
          terms and the honest limitation of each are all still here — they are
          behind the disclosures, which is where detail belongs on a screen
          someone is trying to get through. */}
      {/* The two methods were reading as one scrunched block. They are separate
          choices, so they get real space between them and their own colour —
          blue for the default path, purple for the key path, matching the badge
          each already carries. */}
      <div className="space-y-5">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[14px] font-bold">Method 1</span>
            <ColorBadge tone="blue">default</ColorBadge>
          </div>
          <Steps
            tone="blue"
            steps={[
              "Open Pursuit",
              "Run the plugin",
              "Add jobs",
              "Pursuit rates them",
            ]}
          />
          <div className="mt-2">
            <MoreInfo label="What does Pursuit's own rating do?">
              It matches your <span className="font-semibold text-foreground">keywords</span>{" "}
              — literally, instantly, offline, and with every signal that moved
              the number written out so you can argue with it. Genuinely useful
              and genuinely dumb: it cannot tell a “senior product designer”
              from “senior developer, product team”.
            </MoreInfo>
          </div>
        </div>

        <div className="border-t border-border pt-5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[14px] font-bold">Method 2</span>
            <ColorBadge tone="purple">better</ColorBadge>
          </div>
          <Steps
            tone="purple"
            steps={[
              "Add a Claude key",
              "Run the plugin",
              "Add jobs",
              "Claude adds full reasoning",
            ]}
          />
          <div className="mt-2">
            <MoreInfo label="What does the key cost, and where does it go?">
              Claude reads the whole posting against the{" "}
              <span className="font-semibold text-foreground">description</span>{" "}
              you just wrote and produces its own reasoning for each track. Under
              $0.01 a job, billed to you by Anthropic — we bill nothing. The key
              is stored in this browser, sent only to api.anthropic.com, and
              stripped out of every export. Skipping it costs you nothing: the
              app is fully usable without one.
            </MoreInfo>
          </div>
        </div>
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
