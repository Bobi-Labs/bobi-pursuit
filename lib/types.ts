/**
 * The shared type contract.
 *
 * Every module in this app codes against exactly these shapes — the store, the
 * rule scorer, the capture parser, and every screen. One document, held in the
 * user's browser, is the whole data layer. There is no server, no database, and
 * no user id, so these types are also the *file format*: what `exportJson()`
 * writes is this, verbatim, minus the one secret (see `PursuitSettings`).
 *
 * Two consequences worth stating out loud:
 *
 * 1. **Widening a field here changes a file format that is already on someone's
 *    disk.** Additive changes are free; renames and removals need
 *    `SCHEMA_VERSION` bumped and a repair path in the store's importer.
 * 2. **Every string field is a string, never `null` or optional.** An empty
 *    string is the empty value. This deletes an entire class of
 *    `undefined is not an object` bugs from the render tree, and it means the
 *    importer can repair a half-written document by coercing rather than
 *    rejecting it.
 */

import { newId } from "@/lib/id";

/* ─────────────────────────────── Tones ─────────────────────────────── */

/**
 * The badge palette, ported from the dashboard's `TONE_BADGE`. A track carries
 * its own colour so the same track reads the same everywhere — the score chip,
 * the kanban card, the studio tab.
 */
export type ColorTone = "green" | "amber" | "blue" | "purple" | "cyan" | "rose";

export const COLOR_TONES: ColorTone[] = [
  "green",
  "amber",
  "blue",
  "purple",
  "cyan",
  "rose",
];

export function isColorTone(value: unknown): value is ColorTone {
  return typeof value === "string" && (COLOR_TONES as string[]).includes(value);
}

/* ──────────────────────────── Scoring tracks ──────────────────────────── */

/**
 * A **track**: one thing you are looking for, in your own words.
 *
 * This replaces three hardcoded profiles (`contract_stack` / `fte_pm` /
 * `micro_async`) that were, honestly, one person's job search compiled into the
 * source. A designer, a nurse and a data engineer all got the same three
 * meaningless buckets. Now the buckets are yours.
 *
 * A single "fit score" is still a lie when you are open to more than one kind of
 * work — a posting that is a 90 for contract work is a 20 for a salaried role —
 * so scoring stays per-track. What changed is who defines the tracks.
 *
 * The four fields do genuinely different jobs, and it is worth being precise
 * about which engine reads which:
 *
 *   - `keywords` / `excludeKeywords` — **the rule scorer**. Literal, boundary-
 *     matched terms. Cheap, deterministic, and you can read exactly why a number
 *     came out the way it did.
 *   - `description` — **the model**, on the bring-your-own-key tier. Prose it
 *     judges the posting against. This is the field that understands "I want a
 *     seat close to engineering" when the posting never says those words.
 *
 * That split *is* the free-vs-key ladder: rules match your keywords, the model
 * understands your description. The description still earns a small, named bonus
 * in the rule tier (shared vocabulary between your prose and the posting), but
 * it is deliberately a nudge, not the engine.
 *
 * `id` is stable and never derived from `name` — renaming a track must not
 * orphan every score that referenced it.
 */
export interface Profile {
  id: string;
  /** Full label: "Contract dev work". */
  name: string;
  /** ≤10 chars, for dense badges and table cells: "Contract". */
  short: string;
  /** Prose. What an LLM judges a posting against. The key field. */
  description: string;
  /** Rule scorer: positive signals. */
  keywords: string[];
  /** Rule scorer: deal-breakers **for this track only**. */
  excludeKeywords: string[];
  tone: ColorTone;
}

/** One track is the floor (zero tracks scores nothing); five is the ceiling. */
export const MIN_PROFILES = 1;
export const MAX_PROFILES = 5;

/** At or above this, a track counts as a match worth surfacing. */
export const PROFILE_MATCH_THRESHOLD = 60;

/**
 * The three ids the pre-v2 schema used. Kept as constants because the migration
 * reuses them verbatim: a stored score keyed `"contract_stack"` must still
 * resolve after the upgrade, or every number on the board silently becomes an
 * orphan.
 */
export const LEGACY_PROFILE_IDS = {
  contract: "contract_stack",
  fte: "fte_pm",
  micro: "micro_async",
} as const;

/** The one track a brand-new document starts with. Stable id — see `defaultSettings()`. */
export const STARTER_PROFILE_ID = "starter";

export function isProfile(value: unknown): value is Profile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Profile).id === "string"
  );
}

/** Picks a tone nothing else is using, so a new track is visually distinct. */
export function nextTone(existing: Profile[]): ColorTone {
  const taken = new Set(existing.map((p) => p.tone));
  return COLOR_TONES.find((tone) => !taken.has(tone)) ?? "green";
}

/* ─────────────────────────── Onboarding presets ─────────────────────────── */

/**
 * A blank prose box is a wall. These are the answer: real, specific starting
 * points a user picks and then edits, rather than an empty textarea and a
 * cheerful "describe what you're looking for!".
 *
 * They are written as if a person wrote them, because that is what makes them
 * useful to edit — a placeholder reads as something to replace, a real sentence
 * reads as something to adjust. The keyword lists are the terms that actually
 * appear in postings for that kind of work, not aspirational vocabulary.
 */
export interface ProfilePreset extends Omit<Profile, "id"> {
  /** Stable key for the picker. Never stored on the profile. */
  key: string;
  /** What the picker button says. */
  label: string;
  /** One line under the label. */
  blurb: string;
}

export const PROFILE_PRESETS: ProfilePreset[] = [
  {
    key: "swe_contract",
    label: "Software engineering — contract/freelance",
    blurb: "Defined builds you can bid on today.",
    name: "Contract dev work",
    short: "Contract",
    tone: "green",
    description:
      "Contract and freelance software work I can bid on today: a defined build with a scope, a budget and an end date. Greenfield MVPs for founders, internal tools and dashboards, API and integration work, and adding AI features to a product that already exists. I want a named deliverable and a disclosed rate or project budget — not an open-ended 'help us with everything'. Remote and async-friendly, working directly with whoever owns the product rather than through an agency.",
    keywords: [
      "typescript",
      "react",
      "next.js",
      "node",
      "python",
      "postgres",
      "api",
      "integration",
      "mvp",
      "dashboard",
      "full-stack",
      "aws",
      "supabase",
    ],
    excludeKeywords: [
      "unpaid",
      "equity only",
      "commission only",
      "security clearance",
      "on-site only",
      "unpaid trial",
    ],
  },
  {
    key: "swe_fulltime",
    label: "Software engineering — full-time",
    blurb: "Salaried engineering roles at a product company.",
    name: "Full-time engineering",
    short: "Full-time",
    tone: "blue",
    description:
      "Salaried, full-time engineering roles at a company where software is the product. Senior or staff individual-contributor work: I want to own a surface end to end, talk to the people who use it, and have a real say in what gets built rather than closing tickets someone else wrote. Small teams over large ones, remote or remote-first. An undisclosed salary band is normal for these postings and is not by itself a reason to skip one.",
    keywords: [
      "software engineer",
      "full-stack",
      "backend",
      "frontend",
      "typescript",
      "react",
      "node",
      "python",
      "go",
      "postgres",
      "platform",
      "distributed systems",
      "senior engineer",
    ],
    excludeKeywords: [
      "unpaid",
      "commission only",
      "security clearance",
      "relocation required",
      "visa sponsorship not available",
    ],
  },
  {
    key: "product",
    label: "Product management",
    blurb: "Senior PM roles where the product is the software.",
    name: "Product management",
    short: "Product",
    tone: "purple",
    description:
      "Full-time product management roles — senior PM, group PM, principal PM, head of product — at startups and scaleups where the product is the software. I want discovery and roadmap ownership, direct contact with users, and engineers who ship weekly. Technical products are the strongest fit: developer tools, APIs, data platforms, AI features. Not a delivery or scrum-master seat, and not an associate or junior PM role.",
    // Deliberately no bare "platform", "api" or "analytics": a keyword found in
    // the TITLE is worth double, and "Full-stack developer — Vue platform" is
    // not a product role. Multi-word PM vocabulary discriminates; single generic
    // nouns do not.
    keywords: [
      "product manager",
      "product management",
      "product owner",
      "head of product",
      "director of product",
      "product lead",
      "product strategy",
      "roadmap",
      "product discovery",
      "user research",
      "prioritization",
      "go-to-market",
      "stakeholder",
      "product-led",
      "backlog",
    ],
    excludeKeywords: [
      "scrum master",
      "project coordinator",
      "delivery manager",
      "associate product manager",
      "unpaid",
    ],
  },
  {
    key: "design",
    label: "Design / UX",
    blurb: "Product design with a real research loop.",
    name: "Product design",
    short: "Design",
    tone: "rose",
    description:
      "Product design and UX roles — interface design, design systems, and end-to-end product thinking rather than visual polish applied at the end. I want a seat close to engineering, a real research loop with actual users, and ownership of a whole surface. Figma-first, comfortable living inside a component library, happy to write the copy as well as draw the box. Full-time or a contract engagement both work.",
    keywords: [
      "product designer",
      "ux designer",
      "ui design",
      "design system",
      "figma",
      "prototyping",
      "user research",
      "wireframe",
      "interaction design",
      "accessibility",
      "usability",
      "design lead",
    ],
    excludeKeywords: [
      "unpaid",
      "spec work",
      "design contest",
      "logo only",
      "commission only",
    ],
  },
  {
    key: "data",
    label: "Data & analytics",
    blurb: "Pipelines, models, and numbers people act on.",
    name: "Data & analytics",
    short: "Data",
    tone: "cyan",
    description:
      "Data roles across analytics engineering, data engineering and analysis: building and maintaining pipelines, modelling warehouse data properly, and turning it into dashboards and decisions people actually use. SQL is the core of the job; dbt, Python and a modern warehouse are the usual surroundings. Full-time or contract — I care more about owning the model than about the job title on it.",
    keywords: [
      "sql",
      "dbt",
      "python",
      "data engineer",
      "analytics engineer",
      "data analyst",
      "data warehouse",
      "snowflake",
      "bigquery",
      "airflow",
      "etl",
      "pipeline",
      "looker",
      "tableau",
      "power bi",
    ],
    excludeKeywords: ["unpaid", "commission only", "security clearance"],
  },
  {
    key: "marketing",
    label: "Marketing / growth",
    blurb: "Measurable growth work, not brand-only.",
    name: "Marketing & growth",
    short: "Growth",
    tone: "amber",
    description:
      "Growth and marketing roles where the work is measurable: lifecycle and email, paid acquisition, SEO and content that compounds, landing-page and pricing experiments. B2B SaaS and product-led companies preferred, somewhere I can talk to the product team and read the data myself instead of waiting on a report. Full-time or a retained contract. Not a brand-only or purely social-media remit, and not a role that is really sales with a different title.",
    keywords: [
      "growth marketing",
      "demand generation",
      "lifecycle marketing",
      "seo",
      "content marketing",
      "paid acquisition",
      "ppc",
      "marketing automation",
      "hubspot",
      "conversion rate",
      "a/b testing",
      "email marketing",
      "b2b saas",
      "analytics",
    ],
    excludeKeywords: [
      "unpaid",
      "commission only",
      "cold calling",
      "door to door",
      "mlm",
    ],
  },
  {
    key: "project",
    label: "Project / programme management",
    blurb: "Owning delivery: scope, plan, budget, risk.",
    name: "Project & programme",
    short: "Delivery",
    tone: "blue",
    description:
      "Project and programme management roles where I own delivery end to end: scope, plan, budget, risks, and getting people who disagree with each other to commit to the same date. Multi-workstream programmes and cross-functional teams, mostly software and product delivery. The unglamorous half of the job is the half I am good at, which is mapping dependencies, writing a status report that says the true thing, and pulling a slipping milestone forward while it is still cheap to move. Agile, waterfall, or the honest hybrid most places actually run. Senior project manager, programme manager or delivery lead level, full-time or fixed-term. Not a coordinator seat taking minutes.",
    keywords: [
      "project manager",
      "programme manager",
      "program manager",
      "delivery manager",
      "delivery lead",
      "project delivery",
      "pmo",
      "portfolio management",
      "prince2",
      "pmp",
      "raid log",
      "risk register",
      "stakeholder management",
      "change control",
      "critical path",
      "agile delivery",
    ],
    excludeKeywords: [
      "unpaid",
      "commission only",
      "project coordinator",
      "project administrator",
      "security clearance",
      "on-site only",
    ],
  },
  {
    key: "operations",
    label: "Operations",
    blurb: "Process and systems that make a company run.",
    name: "Operations",
    short: "Ops",
    tone: "cyan",
    description:
      "Operations roles where the job is making the business actually run: business operations, revenue operations, and the process-and-systems work that stops a growing company tripping over itself. I want to own a messy process end to end, map what really happens rather than what the wiki claims, cut the steps that survive only because the person who invented them left, wire the tools together properly, and put a number on whether any of it got better. At home in a spreadsheet and in the admin panel of every tool we pay for. Startups and scaleups where operations is a real function with a budget. Full-time or a fixed-term engagement. Not an assistant role with a better title.",
    // No bare "lean", "agile" or "kpi": all three are near-universal job-ad
    // filler ("lean team", "agile environment", "KPI-driven"), and a term that
    // appears in every posting cannot tell them apart. "six sigma" and
    // "operational excellence" only turn up where the work is genuinely process.
    keywords: [
      "operations manager",
      "business operations",
      "revenue operations",
      "revops",
      "bizops",
      "head of operations",
      "process improvement",
      "operational excellence",
      "continuous improvement",
      "workflow automation",
      "vendor management",
      "capacity planning",
      "six sigma",
      "standard operating procedure",
    ],
    excludeKeywords: [
      "unpaid",
      "commission only",
      "executive assistant",
      "office manager",
      "shift work",
      "on-site only",
    ],
  },
  {
    key: "admin",
    label: "Administration / PA",
    blurb: "Keeping a person, a team or an office running.",
    name: "Administration",
    short: "Admin",
    tone: "blue",
    description:
      "Administrative and assistant roles where the job is keeping a person, a team or an office running: executive assistant, personal assistant, office manager, senior administrator, team coordinator. Diary and inbox ownership for people whose time is the constraint, travel and meetings booked properly the first time, records kept so the right version is findable a year later, and the invisible work that stops a week falling apart. Discretion with confidential material is assumed rather than listed. Full-time or part-time, in-house rather than through an agency. Not a call-centre seat and not general data entry.",
    // Multi-word vocabulary only, for the same reason the product preset gives:
    // a keyword found in the TITLE counts double, and bare "admin", "office" or
    // "assistant" appear in half the postings on the internet — including
    // "admin panel" and "assistant manager", which are not this job.
    keywords: [
      "executive assistant",
      "personal assistant",
      "administrative assistant",
      "office manager",
      "office administrator",
      "senior administrator",
      "administrative coordinator",
      "team coordinator",
      "executive support",
      "diary management",
      "calendar management",
      "travel coordination",
      "minute taking",
    ],
    excludeKeywords: [
      "unpaid",
      "commission only",
      "cold calling",
      "door to door",
      "security clearance",
    ],
  },
  {
    key: "people",
    label: "People / HR",
    blurb: "Hiring, culture, and the systems behind both.",
    name: "People & HR",
    short: "People",
    tone: "rose",
    description:
      "People and HR roles where the work is designing how a company hires, grows and keeps its staff, not processing the paperwork that results. Hiring process and talent acquisition, employee onboarding, performance and progression frameworks, pay bands, and the HRIS that has to hold all of it together. I want to sit close to the leadership team and be asked before a decision is made rather than handed it afterwards. The strongest fit is a scaleup building the function properly for the first time, or a people partner seat somewhere that already takes it seriously. Full-time or a fixed-term contract. Not agency recruitment with a commission target attached.",
    // "onboarding" is qualified to "employee onboarding" here, and to "customer
    // onboarding" in the track below. Bare "onboarding" is product and
    // engineering vocabulary too, so it would hand this track a false positive
    // on every SaaS posting that happens to mention its signup flow.
    keywords: [
      "human resources",
      "people operations",
      "people partner",
      "hr business partner",
      "hrbp",
      "talent acquisition",
      "recruiting manager",
      "employee onboarding",
      "employee relations",
      "performance management",
      "compensation and benefits",
      "hris",
      "workday",
      "bamboohr",
      "learning and development",
      "employer brand",
    ],
    excludeKeywords: [
      "unpaid",
      "commission only",
      "recruitment consultant",
      "360 recruitment",
      "cold calling",
      "security clearance",
    ],
  },
  {
    key: "customer",
    label: "Customer success / support",
    blurb: "Owning accounts and outcomes, not a ticket quota.",
    name: "Customer success",
    short: "Success",
    tone: "purple",
    description:
      "Customer success and support roles where I own the relationship and the outcome: onboarding new accounts, driving adoption that is real rather than reported, spotting churn risk long before the renewal call, and being the person in the building who actually knows what customers are trying to do. B2B SaaS preferred, and technical enough that I can answer most of it myself and close the loop with product on the rest. Judge me on retention and expansion, not on tickets closed per hour or average handle time. Full-time and remote.",
    keywords: [
      "customer success",
      "csm",
      "account management",
      "customer onboarding",
      "churn",
      "retention",
      "renewals",
      "expansion revenue",
      "customer support",
      "technical support",
      "customer experience",
      "zendesk",
      "intercom",
      "qbr",
      "b2b saas",
    ],
    excludeKeywords: [
      "unpaid",
      "commission only",
      "cold calling",
      "outbound sales",
      "call centre",
      "call center",
      "shift work",
    ],
  },
  {
    key: "finance",
    label: "Finance",
    blurb: "Close the books, then explain the numbers.",
    name: "Finance & accounting",
    short: "Finance",
    tone: "amber",
    description:
      "Finance roles that go past bookkeeping: month-end close and management accounts, budgeting and forecasting, and the FP&A work of explaining to the rest of the business why a number moved and what to do about it. Startups and scaleups small enough that I own a whole area, as a financial controller, finance manager or FP&A analyst rather than one line of a large accounts team. Qualified or part-qualified, at home in both the spreadsheet model and the accounting system, and able to talk to non-finance people in their own language. Full-time, fractional or interim all work.",
    keywords: [
      "financial controller",
      "finance manager",
      "fp&a",
      "management accounts",
      "month-end close",
      "budgeting",
      "forecasting",
      "variance analysis",
      "cash flow",
      "reconciliation",
      "accounts payable",
      "accounts receivable",
      "acca",
      "cima",
      "cpa",
      "xero",
      "netsuite",
      "quickbooks",
    ],
    // "financial advisor" and "insurance sales" look like finance and are not:
    // they are the commission-only roles that flood a finance search, and the
    // posting will not say "commission only" out loud.
    excludeKeywords: [
      "unpaid",
      "commission only",
      "financial advisor",
      "insurance sales",
      "cold calling",
      "security clearance",
    ],
  },
  {
    key: "fixed_scope",
    label: "Fixed-scope freelance gigs",
    blurb: "One-off deliverables with a fixed price.",
    name: "Fixed-scope gigs",
    short: "Gigs",
    tone: "green",
    description:
      "Small, bounded pieces of work with a clear deliverable and a fixed price — the kind of thing that can be specified once and delivered async. Data cleanup and migration, scraping a defined set of pages, document and format conversion, spreadsheet or reporting automation, a one-off integration, a single script. A named quantity ('40k rows', '300 PDFs') and a fixed fee matter more to me than the size of the budget. Not an ongoing seat, and no daily standups.",
    keywords: [
      "data cleaning",
      "data migration",
      "scraping",
      "csv",
      "spreadsheet",
      "excel",
      "google sheets",
      "airtable",
      "etl",
      "automation",
      "script",
      "zapier",
      "webhook",
      "one-off integration",
      "pdf",
      "conversion",
      "transcription",
      "deduplicate",
    ],
    excludeKeywords: [
      "full-time",
      "daily standup",
      "ongoing",
      "long-term team member",
      "equity only",
      "unpaid",
    ],
  },
  {
    key: "blank",
    label: "Start from scratch",
    blurb: "An empty track you write yourself.",
    name: "New track",
    short: "New",
    tone: "green",
    description: "",
    keywords: [],
    excludeKeywords: [],
  },
];

export function findPreset(key: string): ProfilePreset | undefined {
  return PROFILE_PRESETS.find((preset) => preset.key === key);
}

/**
 * Turn a preset into a real track. **Never call during render** — `newId()` is
 * non-deterministic, and a prerendered id that disagrees with the client's is a
 * hydration mismatch.
 */
export function profileFromPreset(
  preset: ProfilePreset,
  overrides: Partial<Profile> = {},
): Profile {
  return {
    id: newId(),
    name: preset.name,
    short: preset.short,
    description: preset.description,
    keywords: [...preset.keywords],
    excludeKeywords: [...preset.excludeKeywords],
    tone: preset.tone,
    ...overrides,
  };
}

/* ─────────────────────────────── Pipeline ─────────────────────────────── */

/**
 * Where a job sits.
 *
 * Nothing here moves on its own. The free tier has no proposal drafter and no
 * way to read your email, so every one of these transitions happens because a
 * person said it happened. A stage the software cannot advance on its own is an
 * honest stage.
 *
 * **`applied` is no longer the end.** It was, and that made the board stop
 * exactly where a job hunt gets interesting: you send an application and then
 * something happens, or — far more often — nothing does. Two stages close the
 * loop:
 *
 *  - `interviewing` — they came back and something is live. Deliberately ONE
 *    flat stage: no phone-screen / technical / onsite ladder. Which round you
 *    are on is a line of notes, not a schema.
 *  - `declined` — they said no.
 *
 * **`ignored` is "skipped", and there is deliberately no separate `skipped`
 * value.** The two words describe one state that already existed — the card
 * button says "Skip" and the destination reads "Ignored", which is why they
 * sounded like different things. The distinction worth keeping is a different
 * one, and these two values carry it exactly: **`declined` is their decision
 * after you applied; `ignored` is your decision before you did.**
 */
export type PipelineStatus =
  | "triage"
  | "promoted"
  | "applied"
  | "interviewing"
  | "declined"
  | "ignored";

/** Canonical order: the live board left to right, then the two closed states. */
export const PIPELINE_STATUSES: PipelineStatus[] = [
  "triage",
  "promoted",
  "applied",
  "interviewing",
  "declined",
  "ignored",
];

/**
 * Derived from the array on purpose.
 *
 * This was a hand-written `value === "triage" || …` chain, which made the list
 * above and the guard two independent copies of the same fact. Adding a status
 * to one and not the other compiles perfectly cleanly and then fails at
 * runtime in the worst available way: `repairJob` coerces anything this guard
 * rejects to "triage" and writes the flattened document straight back to
 * localStorage. A silent, permanent demotion of every card in the new stage.
 *
 * One list now. `isColorTone` already does it this way.
 */
export function isPipelineStatus(value: unknown): value is PipelineStatus {
  return (
    typeof value === "string" &&
    (PIPELINE_STATUSES as string[]).includes(value)
  );
}

/* ──────────────────────────────── Scores ──────────────────────────────── */

export interface ProfileScore {
  fit: number;
  reasoning: string;
}

/**
 * Keyed by **profile id**, not by a fixed union.
 *
 * Two consequences the whole app depends on:
 *
 *   - renaming a track keeps its scores (the id never changes);
 *   - deleting a track leaves *orphan* keys behind. Nothing may crash on those.
 *     `reconcileScoreToProfiles()` in the rule scorer is the one place that
 *     prunes them, and every consumer should look scores up by walking
 *     `settings.profiles`, not by walking this record.
 */
export type ProfileScores = Record<string, ProfileScore>;

export interface JobScore {
  /** MAX across the tracks that currently exist — the number the board sorts on. */
  fitScore: number;
  /** argmax profile **id**, but only when it clears `PROFILE_MATCH_THRESHOLD`. */
  bestProfile: string | null;
  /** Every track at or above threshold, best first. Profile ids. */
  matchedProfiles: string[];
  profileScores: ProfileScores;
  redFlags: string[];
  greenFlags: string[];
  reasoning: string;
  /** Which engine produced this — `"rules-v2"` in the free tier. */
  engine: string;
  scoredAt: string;
}

/* ───────────────────────────────── Jobs ───────────────────────────────── */

export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  /** `"manual"`, `"extension"`, or the hostname the capture came from. */
  source: string;
  location: string;
  budgetHint: string;
  pipelineStatus: PipelineStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When `pipelineStatus` last changed — NOT when the job was last edited.
   *
   * The difference is the entire point. `updatedAt` moves on every write,
   * including a keystroke in the notes box, so "how long has this been sitting
   * in Applied" cannot be answered from it: jotting "emailed them Tuesday" on
   * the job you are chasing hardest would reset its age to zero, which is
   * exactly backwards. This field only moves when the card does.
   *
   * Optional in practice rather than in type: `repairJob` fills it from
   * `updatedAt` for any document written before it existed, so every saved
   * board self-heals on load with no migration function. Those values are
   * approximations of history, which is honest — the real history was never
   * recorded and cannot be reconstructed.
   */
  statusChangedAt: string;
  score: JobScore | null;
}

/* ─────────────────────────────── Settings ─────────────────────────────── */

/**
 * `targetHourlyRate` and `eligibleLocations` stay top-level on purpose: they are
 * facts about the **person**, not about a track. You are not eligible in one
 * region on Tuesdays and a different one on Thursdays, and your floor rate does
 * not change because you filed a posting under a different tab.
 *
 * Keywords, by contrast, moved *into* the tracks — that is the whole point of
 * the v2 model. A "stack" is only meaningful if everyone using this app is
 * hunting the same kind of job, and they are not.
 */
export interface PursuitSettings {
  profileName: string;
  bio: string;
  /** 1..5, enforced by the UI and by the store's repair pass. Order is meaningful. */
  profiles: Profile[];
  /**
   * The money floor, always stored **per hour**, whatever the user types.
   *
   * Keeping one canonical unit is the whole design. The rule scorer already
   * understands salaries — it compares a posting's annual figure against
   * `targetHourlyRate * FTE_HOURS_PER_YEAR` — so supporting salary input never
   * needed a scoring change, only a way to say it. Storing whichever unit the
   * user last picked would have meant every consumer of this field asking
   * "which unit is this?" and one of them eventually forgetting.
   */
  targetHourlyRate: number;
  /**
   * Which unit the rate field *displays*. Presentation only; nothing scores off
   * it. Absent in documents written before this existed, which `repairSettings`
   * fills as "hourly" — the behaviour those users already had.
   */
  rateMode: "hourly" | "annual";
  eligibleLocations: string[];
  /**
   * Tier 2 only; `""` here. **Never written to an export** — see
   * `store.exportJson()`. A key in a file the user emails themselves is a key
   * on someone else's mail server.
   */
  anthropicApiKey: string;
}

/* ──────────────────────────────── Document ──────────────────────────────── */

/**
 * v1 → v2: `settings.stackKeywords` / `settings.excludeKeywords` were replaced
 * by `settings.profiles`, and `JobScore.profileScores` went from three fixed
 * keys to profile ids. The store migrates on load, reusing the three legacy ids
 * so existing scores keep resolving. See `migrateSettings()` in the store.
 */
/**
 * Bumped 2 → 3 when `interviewing` and `declined` were added.
 *
 * Backwards this changes nothing: an old document contains only old values and
 * `version > SCHEMA_VERSION` is false, so every saved board opens untouched.
 *
 * It exists for FORWARD safety, and the case is specific. Without the bump, a
 * tab left open across a deploy runs the previous build against a document
 * containing the new statuses, `repairJob` coerces each of them to "triage",
 * and the flattened document is written back — silently, permanently, landing
 * on the interview you were waiting for. With the bump that build refuses at
 * the gate and sets the raw copy aside instead. Alarming, loud, recoverable.
 */
export const SCHEMA_VERSION = 3;

/** Stamped on every document so an importer can reject a foreign JSON file. */
export const DOC_KIND = "bobi-pursuit.pipeline";

export interface PursuitDoc {
  kind: typeof DOC_KIND;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  settings: PursuitSettings;
  jobs: Job[];
}

/**
 * Starter settings.
 *
 * These are *opinionated on purpose*. An empty track would score every job a
 * flat zero on first run, which reads as "this thing is broken" rather than
 * "you have not configured it yet". A new user sees plausible numbers
 * immediately and then edits the track — or replaces it from `PROFILE_PRESETS`.
 *
 * The starter is deliberately **one** track and deliberately **broad**: it names
 * both contract and full-time work so neither framing is penalised before the
 * user has told us which they want. Onboarding's job is to narrow it.
 *
 * The id is the fixed string `"starter"`, not a `newId()`. This function is
 * called at module load to build the frozen prerender document, and a random id
 * baked into `out/index.html` would not match the client's — a hydration
 * mismatch waiting for the first component that renders a track key.
 *
 * The bio stays because it is the only description of *who you are* that the
 * Tier 2 prompt has, and shipping it empty made the sample data undersell the
 * tool. It is a plausible person, nobody real.
 */
export function defaultSettings(): PursuitSettings {
  return {
    profileName: "",
    bio: "About ten years building web products, the last few as a hands-on product lead who still writes the code. Comfortable across TypeScript, React and Postgres, and recently spending most of my time wiring LLM features into existing apps. I work best on small teams with clear scope, owning something end to end.",
    profiles: [
      {
        id: STARTER_PROFILE_ID,
        name: "Software engineering",
        short: "Eng",
        tone: "green",
        description:
          "Software engineering roles I would actually take — contract or full-time, I am open to both. Product work in TypeScript and React on the front, Node or Python and Postgres behind it, increasingly wiring LLM features into apps that already exist. I want a real scope, a team that ships, and remote-first working. Senior level: I own a surface end to end rather than close tickets someone else wrote.",
        keywords: [
          "typescript",
          "react",
          "next.js",
          "node",
          "postgres",
          "tailwind",
          "api",
          "supabase",
        ],
        excludeKeywords: [
          "unpaid",
          "equity only",
          "commission only",
          "security clearance",
          "on-site only",
        ],
      },
    ],
    targetHourlyRate: 75,
    rateMode: "hourly",
    eligibleLocations: ["remote"],
    anthropicApiKey: "",
  };
}

export function emptyDoc(): PursuitDoc {
  const ts = new Date().toISOString();
  return {
    kind: DOC_KIND,
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
    settings: defaultSettings(),
    jobs: [],
  };
}
