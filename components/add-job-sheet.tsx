"use client";

/**
 * Capture a job — by hand, or from a capture link.
 *
 * The capture path is the important one, and it is the front door of this whole
 * tier. The browser extension and the bookmarklet both open the app at
 * `?add=1&t=…&u=…&d=…&b=…&s=…`; the shell parses that (in an effect, never during
 * render) and hands the result here as `prefill`. The form is then already
 * filled in, and the only thing between a posting in a tab and a scored card on
 * the board is one click.
 *
 * The confirmation after saving is not decoration: it shows the fit the scorer
 * just produced and which of *your* tracks earned it. A capture that did not
 * show you a verdict would make this a bookmark manager.
 */

import { useState } from "react";

import type { CaptureParams } from "@/lib/capture";
import { bestLabel } from "@/lib/profile-view";
import type { Job, Profile } from "@/lib/types";

import { Button, ColorBadge, Field, INPUT, ScoreChip, Sheet, cx } from "./ui";

export interface NewJobInput {
  title: string;
  company: string;
  url: string;
  description: string;
  budgetHint: string;
  location: string;
  source: string;
}

export interface AddResult {
  job: Job;
  /** True when the URL already existed — the store returned the job you had. */
  duplicate: boolean;
}

const BLANK: NewJobInput = {
  title: "",
  company: "",
  url: "",
  description: "",
  budgetHint: "",
  location: "",
  source: "manual",
};

function fromPrefill(prefill: CaptureParams | null): NewJobInput {
  if (!prefill) return BLANK;
  return {
    title: prefill.title,
    company: prefill.company,
    url: prefill.url,
    description: prefill.description,
    budgetHint: prefill.budgetHint,
    location: "",
    source: prefill.source || "manual",
  };
}

export function AddJobSheet({
  prefill,
  profiles,
  onAdd,
  onOpenJob,
  onClose,
}: {
  prefill: CaptureParams | null;
  profiles: Profile[];
  onAdd: (input: NewJobInput) => AddResult;
  onOpenJob: (id: string) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<NewJobInput>(() => fromPrefill(prefill));
  const [result, setResult] = useState<AddResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof NewJobInput>(key: K, value: NewJobInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function submit() {
    if (!form.title.trim()) {
      setError("A title is the one thing this needs — everything else is optional.");
      return;
    }
    setError(null);
    setResult(onAdd(form));
  }

  function addAnother() {
    setForm(BLANK);
    setResult(null);
    setError(null);
  }

  return (
    <Sheet
      open
      title={prefill ? "Capture this job" : "Add a job"}
      subtitle={
        prefill
          ? `Captured from ${prefill.source}. Check it over, then save — it is scored on the way in.`
          : "Paste a posting. It gets scored against your tracks the moment you save it."
      }
      onClose={onClose}
      footer={
        result ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {result.duplicate ? "Already on your board." : "Saved to Triage."}
            </span>
            <span className="flex gap-1.5">
              <Button size="md" onClick={addAnother}>
                Add another
              </Button>
              <Button
                size="md"
                variant="primary"
                onClick={() => {
                  onOpenJob(result.job.id);
                  onClose();
                }}
              >
                Open in Job Studio →
              </Button>
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              Stays in this browser. Nothing is uploaded.
            </span>
            <span className="flex gap-1.5">
              <Button size="md" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="md"
                variant="primary"
                onClick={submit}
                disabled={!form.title.trim()}
              >
                Save &amp; score
              </Button>
            </span>
          </div>
        )
      }
    >
      {result ? (
        <ScoreSummary result={result} profiles={profiles} />
      ) : (
        <div className="space-y-3">
          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300">
              {error}
            </div>
          ) : null}

          <Field label="Title">
            <input
              className={INPUT}
              value={form.title}
              autoFocus
              onChange={(e) => set("title", e.target.value)}
              placeholder="Senior Product Manager — payments"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Company">
              <input
                className={INPUT}
                value={form.company}
                onChange={(e) => set("company", e.target.value)}
                placeholder="Halyard Systems"
              />
            </Field>
            <Field label="Source">
              <input
                className={INPUT}
                value={form.source}
                onChange={(e) => set("source", e.target.value)}
                placeholder="manual"
              />
            </Field>
          </div>

          <Field label="URL" hint="Used to spot a posting you have already captured.">
            <input
              className={cx(INPUT, "font-mono")}
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Budget hint" hint="“$85–100/hr”, “€90k”, anything the post says.">
              <input
                className={INPUT}
                value={form.budgetHint}
                onChange={(e) => set("budgetHint", e.target.value)}
                placeholder="$85-100/hr"
              />
            </Field>
            <Field label="Location" hint="Feeds the eligibility check in Settings.">
              <input
                className={INPUT}
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Remote (EU)"
              />
            </Field>
          </div>

          <Field
            label="Description"
            hint="Paste the whole posting. The scorer only knows what you give it."
          >
            <textarea
              className={cx(INPUT, "min-h-[220px] resize-y leading-relaxed")}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Paste the job description here…"
            />
          </Field>
        </div>
      )}
    </Sheet>
  );
}

/** The verdict, immediately after saving. */
function ScoreSummary({
  result,
  profiles,
}: {
  result: AddResult;
  profiles: Profile[];
}) {
  const { job, duplicate } = result;
  const score = job.score;
  const best = bestLabel(score, profiles);

  return (
    <div className="space-y-3">
      {duplicate ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
          You already had this URL on the board, so nothing was added — this is
          the card you already have.
        </div>
      ) : null}

      <div className="rounded-[10px] border border-border bg-card/60 p-3.5">
        <div className="text-[13px] font-semibold leading-snug">{job.title}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {[job.company, job.source].filter(Boolean).join(" · ")}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ScoreChip score={score?.fitScore ?? null} label="fit" />
          {best ? (
            <ColorBadge tone={best.tone} title={best.name}>
              {best.name}
            </ColorBadge>
          ) : (
            <ColorBadge tone="muted">no track matched</ColorBadge>
          )}
          {score?.redFlags.slice(0, 2).map((flag) => (
            <ColorBadge key={flag} tone="red">
              {flag.replace(/_/g, " ")}
            </ColorBadge>
          ))}
        </div>

        {score ? (
          <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
            {score.reasoning}
          </p>
        ) : null}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Open it in Job Studio to see every track&apos;s number side by side — the
        headline is only the best of them.
      </p>
    </div>
  );
}
