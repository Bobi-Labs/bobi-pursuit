"use client";

/**
 * The primitive kit.
 *
 * Every visual atom the app has, in one file, with no UI library underneath it
 * (no Radix, no shadcn, no clsx) — a local-first tool that a stranger downloads
 * should be readable end to end and should not ship 300 kB of runtime to render
 * a badge.
 *
 * **These are ports, not lookalikes.** Bobi-Pursuit free and the self-hosted
 * Bobi dashboard are the same product at two price points, so the badge, the
 * score chip, the score ring, the KPI card, the panel card and the folder tabs
 * below are lifted from `components/dashboard/dashboard-studio.tsx` with their
 * class strings intact, retargeted at the shared token layer in `globals.css`.
 * If you are tempted to "improve" a padding value here, change it upstream
 * first — a free tier that drifts is a free tier that stops advertising the
 * paid one.
 *
 * Three rules everything here obeys:
 *
 *  1. **Nothing reads `window`, `document` or storage during render.** The app
 *     is statically exported, which means every component below is first
 *     rendered by Node at build time. `Sheet` touches `document` only inside an
 *     effect.
 *  2. **Tokens, not palette literals.** `bg-card`, `text-muted-foreground`,
 *     `border-border`, `text-primary` — never `bg-zinc-900`. The one exception
 *     is the semantic tone ramp below, where the named Tailwind hues *are* the
 *     semantics (emerald = good, red = bad) and match upstream exactly.
 *  3. **Numbers are `font-mono`.** Scores, budgets, counts, ages. Always.
 */

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

/** The world's smallest `clsx`. Falsy parts drop out; that is the whole feature. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ──────────────────────────────── Tones ───────────────────────────────── */

/**
 * The semantic colour vocabulary. Ported name-for-name from the dashboard's
 * `ColorTone`, including `rose` — which upstream reserves for "this failed but
 * it isn't your fault" states, distinct from `red` ("this is a problem with the
 * job").
 */
export type ColorTone =
  | "green"
  | "amber"
  | "red"
  | "blue"
  | "purple"
  | "cyan"
  | "rose"
  | "muted";

/**
 * Kept as an alias because half this codebase already imports `Tone`. New code
 * should say `ColorTone` — it is the name the paid dashboard uses.
 */
export type Tone = ColorTone;

export const TONE_BADGE: Record<ColorTone, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  red: "bg-red-500/10 text-red-400 border-red-500/30",
  blue: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  purple: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  muted: "bg-card text-muted-foreground border-border",
};

export const TONE_DOT: Record<ColorTone, string> = {
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
  blue: "bg-blue-400",
  purple: "bg-violet-400",
  cyan: "bg-cyan-400",
  rose: "bg-rose-400",
  muted: "bg-muted-foreground",
};

/** Solid text colour per tone, for numbers and headings that carry a verdict. */
export const TONE_TEXT: Record<ColorTone, string> = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
  blue: "text-blue-400",
  purple: "text-violet-400",
  cyan: "text-cyan-400",
  rose: "text-rose-400",
  muted: "text-muted-foreground",
};

/**
 * The fit → colour ladder, shared by every surface that shows a number.
 *
 * The bands are the dashboard's, unchanged: 60 is "a real match" (amber), 75 is
 * "stop reading, go apply" (green), and below 40 is red because a job you
 * should not spend an afternoon on ought to look like one.
 */
export function fitTone(fit: number | null): ColorTone {
  if (fit == null) return "muted";
  if (fit >= 75) return "green";
  if (fit >= 60) return "amber";
  if (fit >= 40) return "blue";
  return "red";
}

/**
 * A stable colour for a scoring profile.
 *
 * Deliberately keyed by `string`, not by a closed union. Profiles are the user's
 * own — a nurse's "night shift, local" is as real a profile as a developer's
 * "contract, stack" — so this map cannot enumerate them ahead of time. The three
 * entries below are seeds for the shipped defaults; anything else is coloured by
 * `profileTone()`, which hashes the key so the same profile keeps the same
 * colour across sessions and machines.
 */
export const PROFILE_TONE: Record<string, ColorTone> = {
  contract_stack: "green",
  fte_pm: "blue",
  micro_async: "amber",
};

/** The rotation user-defined profiles are assigned from, in order. */
const PROFILE_TONE_CYCLE: ColorTone[] = [
  "green",
  "blue",
  "amber",
  "purple",
  "cyan",
  "rose",
];

/**
 * Tone for any profile key, seeded or user-invented. Deterministic: the hash is
 * over the key string, so a profile named "nights" is the same colour on every
 * device that opens the file.
 */
export function profileTone(key: string): ColorTone {
  const seeded = PROFILE_TONE[key];
  if (seeded) return seeded;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PROFILE_TONE_CYCLE[h % PROFILE_TONE_CYCLE.length];
}

/* ────────────────────────────── Atoms ─────────────────────────────────── */

export function Dot({ tone, pulse }: { tone: ColorTone; pulse?: boolean }) {
  return (
    <span
      className={cx(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        TONE_DOT[tone],
        pulse && "animate-pulse",
      )}
    />
  );
}

/** The workhorse label. Upstream calls it `ColorBadge`; `Badge` is the alias. */
export function ColorBadge({
  tone = "muted",
  title,
  className,
  children,
}: {
  tone?: ColorTone;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold",
        TONE_BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Historical name, kept so existing imports keep compiling. Same component. */
export const Badge = ColorBadge;

/** A fit number, coloured by band. `null` renders as an honest "unscored". */
export function ScoreChip({
  score,
  label,
}: {
  score: number | null;
  label?: string;
}) {
  if (score == null) return <ColorBadge tone="muted">unscored</ColorBadge>;
  const tone = fitTone(score);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[12px] font-bold",
        TONE_BADGE[tone],
      )}
    >
      <Dot tone={tone} />
      {score}
      {label ? (
        <span className="font-sans font-medium opacity-70">{label}</span>
      ) : null}
    </span>
  );
}

/**
 * The headline number. A conic gradient — no SVG, no dependency, one element
 * masked by another.
 *
 * Emerald regardless of the score, exactly as upstream: the ring's *arc length*
 * is the verdict, and recolouring it as well double-encodes the same fact while
 * costing the panel its one fixed point of colour. The band colour lives on the
 * `ScoreChip` next to it.
 */
export function ScoreRing({
  score,
  size = 56,
}: {
  score: number | null;
  size?: number;
}) {
  const pct = Math.max(0, Math.min(100, score ?? 0));
  return (
    <div
      className="relative mx-auto mt-1 shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(var(--primary) 0% ${pct}%, var(--card) ${pct}% 100%)`,
      }}
    >
      <div className="absolute inset-1 grid place-items-center rounded-full bg-card">
        <span
          className="font-mono font-extrabold leading-none text-emerald-400"
          style={{ fontSize: Math.round(size * 0.27) }}
        >
          {score ?? "—"}
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────────── Containers ─────────────────────────────── */

export function KpiCard({
  label,
  value,
  delta,
  deltaTone = "muted",
  onClick,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "good" | "warn" | "bad" | "muted";
  /** Optional — a KPI that filters the board when clicked earns a hover state. */
  onClick?: () => void;
}) {
  const c =
    deltaTone === "good"
      ? "text-emerald-400"
      : deltaTone === "warn"
        ? "text-amber-400"
        : deltaTone === "bad"
          ? "text-red-400"
          : "text-muted-foreground";
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-[26px] font-extrabold leading-none -tracking-[0.02em]">
        {value}
      </div>
      {delta && <div className={cx("mt-1.5 text-[12px]", c)}>{delta}</div>}
    </>
  );
  const shell = "rounded-[10px] border border-border bg-card/55 p-3.5";
  if (!onClick) return <div className={shell}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(shell, "w-full text-left transition-colors hover:bg-muted/40")}
    >
      {body}
    </button>
  );
}

export function PanelCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-[10px] border border-border bg-card/50 p-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-bold -tracking-[0.01em]">{title}</h2>
        {sub && (
          <div className="mt-1 max-w-[720px] text-[14px] text-muted-foreground">
            {sub}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * The one explanation a surface is allowed to make.
 *
 * Explanatory prose used to sit stacked above the card it described, which put a
 * wall of text between the reader and the UI and got skipped anyway. A `HintCard`
 * is that paragraph lifted out into a floating aside the caller parks beside the
 * main card. The eye lands on it because it is warm and faintly lit, not because
 * it is blocking the way — so the copy inside should be cut to the point rather
 * than moved across intact.
 *
 * Amber, not red. Red already means "this is broken" everywhere else here (see
 * `TONE_BADGE`), and a first-run explanation is not a failure. Amber is the only
 * warm note on a screen of emerald and navy, which is exactly why it pulls the
 * eye without raising an alarm.
 *
 * **One per surface.** That glow is a scarce resource and it works only while it
 * is the single warm thing in view: a second card halves it, a third spends it
 * entirely. If everything glows, nothing does. When a surface seems to need a
 * second hint, the fix is almost always shorter copy in the first one, or a
 * `Field` hint sitting next to the control it actually concerns.
 *
 * Deliberately dumb — no icon, no dismiss, no opinion about position. The caller
 * owns layout (grid column, width, `sticky top-4`) through `className`, because
 * "left of the card" and "right of the card" are the same component.
 */
export function HintCard({
  title,
  className,
  children,
}: {
  /** Two words, ideally. Rendered as the same micro-label as `SectionLabel`. */
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        // The glow mirrors the shape of `glow-primary` in globals.css (tight,
        // negative spread) in amber. A wide or opaque shadow turns this into a
        // highlighter stripe, and the card stops reading as part of the app.
        "rounded-[10px] border border-l-[3px] border-amber-500/25 border-l-amber-400/80 bg-elevated p-3.5 shadow-[0_0_18px_-8px_rgba(245,158,11,0.55)]",
        className,
      )}
    >
      {title ? (
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-400">
          {title}
        </div>
      ) : null}
      {/* Body sits at foreground brightness rather than `--text-muted`: this is
          the copy the card exists to get read, and dimming it would spend the
          border and the glow on text the eye then slides off. 14px is the prose
          floor from the legibility pass. */}
      <div className="text-[14px] leading-snug text-foreground">{children}</div>
    </div>
  );
}

/** The one-line "nothing here yet" a panel shows instead of an empty grid. */
export function EmptyMini({ text }: { text: string }) {
  return (
    <div className="py-10 text-center text-[14px] text-muted-foreground">
      {text}
    </div>
  );
}

/** A kanban column: labelled, counted, scrolls internally, never collapses. */
export function KanbanCol({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count: number;
  /** Shown in place of the em-dash when the column is empty. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[480px] flex-col rounded-[10px] border border-border bg-muted/30">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-[14px] font-bold">{label}</span>
        <span className="rounded-full border border-border bg-card px-1.5 py-0.5 font-mono text-[12px] font-semibold text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {count === 0 ? (
          <div className="py-6 text-center text-[14px] text-muted-foreground">
            {hint ?? "—"}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Controls ─────────────────────────────── */

export function Chip({
  on,
  onClick,
  title,
  children,
}: {
  on?: boolean;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cx(
        "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
        on
          ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-400"
          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** The underline sub-tab used inside a panel (Working / Completed, etc.). */
export function SubTabBtn({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-[14px] font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count != null && (
        <span
          className={cx(
            "rounded-full border px-1.5 py-px font-mono text-[12px] font-semibold",
            active
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-border bg-card text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Segmented control. Generic over the option union so callers keep their types. */
export function ViewToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
      {options.map((x) => (
        <button
          key={x}
          type="button"
          onClick={() => onChange(x)}
          className={cx(
            "rounded px-2.5 py-1 text-[12px] font-medium capitalize transition-colors",
            value === x
              ? "bg-card text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {x}
        </button>
      ))}
    </div>
  );
}

/* ────────────────────────────── Folder tabs ───────────────────────────── */

export type FolderTab<K extends string> = { key: K; label: string };

/**
 * The product's primary navigation: raised manila-folder tabs that sit *on* the
 * panel below them rather than floating above it.
 *
 * Three details do all the work, and all three are easy to lose in a rewrite:
 *
 *  - `-mb-px` on every tab plus `-mt-px` on the panel makes the two borders
 *    share one pixel.
 *  - the active tab adds `border-b-card` and `z-20`, painting its bottom border
 *    in the panel's own colour so the seam between tab and panel disappears —
 *    that overlap is what makes it read as a folder and not a button row.
 *  - the emerald hairline is a separate absolutely-positioned span bled 1px
 *    outside the tab on three sides, so it caps the rounded top edge cleanly.
 *
 * Generic over the tab key: the free tier's tab set is not the dashboard's, and
 * a caller's `"overview" | "pipeline"` union survives the round trip.
 */
export function FolderTabs<K extends string>({
  tabs,
  active,
  counts,
  onChange,
  className,
}: {
  tabs: readonly FolderTab<K>[];
  active: K;
  counts?: Partial<Record<K, number>>;
  onChange: (k: K) => void;
  className?: string;
}) {
  return (
    <nav
      className={cx("relative z-10 flex gap-0.5 overflow-x-auto pl-1", className)}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const count = counts?.[t.key];
        return (
          <button
            key={t.key}
            type="button"
            // Stable hook for the first-run tour to point at. Generic on purpose:
            // this component knows nothing about the tour beyond the attribute.
            data-tour={`tab-${t.key}`}
            onClick={() => onChange(t.key)}
            aria-current={isActive ? "page" : undefined}
            className={cx(
              "relative -mb-px inline-flex items-center gap-2 whitespace-nowrap rounded-t-[10px] border border-border px-4 py-3 text-[14px] font-medium transition-colors",
              isActive
                ? "z-20 border-b-card bg-card pb-[14px] text-foreground"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {isActive && (
              <span className="absolute left-[-1px] right-[-1px] top-[-1px] h-0.5 rounded-t-[10px] bg-primary" />
            )}
            {t.label}
            {count != null && (
              <span
                className={cx(
                  "rounded-full border px-1.5 py-0.5 font-mono text-[12px] font-semibold",
                  isActive
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The panel a `FolderTabs` row sits on. Square top-left corner (the active tab
 * covers it), rounded everywhere else, pulled up one pixel to meet the tabs.
 */
export function FolderPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "relative -mt-px rounded-b-[12px] rounded-tr-[12px] border border-border bg-card p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ──────────────────────────────── Buttons ─────────────────────────────── */

export type ButtonVariant =
  | "primary"
  | "solid"
  | "default"
  | "ghost"
  | "danger";
export type ButtonSize = "xs" | "sm" | "md";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  // The dashboard's Promote button: emerald wash, emerald hairline.
  primary:
    "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
  // Filled emerald — reserved for the single "do the thing" action on a screen.
  solid:
    "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
  default:
    "border-border bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground",
  ghost:
    "border-transparent bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
  danger:
    "border-destructive/40 bg-destructive/10 text-red-400 hover:bg-destructive/20",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  xs: "px-2 py-1 text-[12px]",
  sm: "px-2.5 py-1.5 text-[12px]",
  md: "px-3 py-2 text-[14px]",
};

export function Button({
  variant = "default",
  size = "sm",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      // Defaulted to "button" on purpose: these live inside <form>, and a stray
      // implicit submit is the classic way a two-field form loses its data.
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className,
      )}
      {...rest}
    />
  );
}

/* ───────────────────────────────── Forms ──────────────────────────────── */

export const INPUT =
  "w-full rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-[14px] text-foreground placeholder:text-text-muted outline-none transition-colors focus:border-primary/50 focus:bg-muted";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[14px] leading-snug text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/* ───────────────────────────────── Sheet ──────────────────────────────── */

/**
 * A right-hand slide-over. Rendered inline rather than through a portal — there
 * is no nested stacking context in this app to escape from, and `createPortal`
 * would mean touching `document.body` during render.
 *
 * The caller is expected to mount this conditionally (`{open && <Sheet …>}`) so
 * the form inside gets fresh state each time it opens; `open` is still honoured
 * so the escape/scroll-lock effect has something to key off.
 */
export function Sheet({
  open,
  title,
  subtitle,
  onClose,
  footer,
  width = "sm:max-w-xl",
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  width?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        className={cx(
          "relative flex h-full w-full flex-col border-l border-border bg-card shadow-2xl",
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold -tracking-[0.01em]">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            Close ✕
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <div className="border-t border-border bg-card px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ──────────────────────────────── Helpers ─────────────────────────────── */

/**
 * "3d", "5h", "12m". Reads the clock, so it is only ever called from a tree that
 * renders after `store.init()` — the prerendered document has no jobs in it.
 */
export function relAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 365) return `${d}d`;
  return `${Math.floor(d / 365)}y`;
}

/**
 * The same instant as a phrase rather than a token: "just now", "3d ago".
 * Callers that want the bare token (dense card corners) use `relAge` directly —
 * appending " ago" to it yourself produces "now ago".
 */
export function relTime(iso: string): string {
  const age = relAge(iso);
  return age === "now" ? "just now" : `${age} ago`;
}

/** `stale_post` → `stale post`. Flags are stored as machine tokens; humans read words. */
export function humanFlag(flag: string): string {
  return flag.replace(/_/g, " ");
}
