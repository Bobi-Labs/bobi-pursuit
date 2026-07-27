/**
 * Sample pipeline — what "Load sample data" drops in.
 *
 * This is the demo, so it has to argue for the product on its own: a
 * stranger clicks one button and should immediately see WHY triage-plus-
 * scoring beats a browser full of tabs. That means a real spread, not ten
 * variations on a good job:
 *
 *   - two clear wins (one contract, one FTE) that should float to the top
 *   - a strong micro/fixed-scope gig, because that profile is easy to miss
 *   - a middle band that is genuinely arguable — the interesting part
 *   - three that should visibly sink: out-of-stack, geo-ineligible, lowball
 *
 * The two rejects at the bottom are deliberate. A scorer that never says
 * no isn't doing anything, and you can't tell whether the filters work
 * until you watch something get filtered.
 *
 * Every company, URL and salary here is invented. No real postings, no
 * real companies, no personal data -- this file ships in a public repo.
 *
 * Jobs are returned UNSCORED (`score: null`). The store runs the rule
 * scorer over them on load, so the sample always reflects the CURRENT
 * scoring settings rather than numbers baked in at authoring time.
 */

import type { Job } from "@/lib/types";

/** Deterministic ISO timestamp `daysAgo` days (and `hoursAgo` hours) back. */
function ago(daysAgo: number, hoursAgo = 0): string {
  const t = Date.now() - daysAgo * 86_400_000 - hoursAgo * 3_600_000;
  return new Date(t).toISOString();
}

/**
 * Ten illustrative jobs, newest first. Stable ids (`sample-01` …) so
 * loading the sample twice updates rather than duplicates.
 */
export function sampleJobs(): Job[] {
  return [
    {
      id: "sample-01",
      title: "Next.js + Supabase contractor — internal ops dashboard",
      company: "Halyard Systems",
      description: `We run freight brokerage software and our operations team currently lives in three spreadsheets and a Retool app nobody maintains. We want to replace it with a real internal dashboard and we want it done properly by one person who has done this before.

Scope, roughly:
- A load board view: filter, sort, saved views, live status per shipment.
- A margin calculator that pulls from our existing Postgres (already on Supabase) and shows per-load profitability.
- Role-based access — dispatchers see their own lanes, managers see everything. Supabase RLS is already partially set up; we need it finished and tested.
- CSV export and a weekly emailed summary.

Stack is fixed and non-negotiable because it is what our one in-house engineer maintains: Next.js (App Router), TypeScript, Supabase (Postgres + Auth + RLS), Tailwind. Deployed on Vercel.

We are looking for roughly 6-10 weeks at 25-30 hours per week, with a hard requirement that you can work independently and write things down. Our in-house engineer will review PRs but will not be pair-programming with you.

Rate: $85-100/hour depending on experience. Paid every two weeks, net 15. We have used contractors before and we pay on time; we can provide references from the last two.

Fully remote. We have people in Lisbon, Chicago and Toronto, so most timezones work as long as you can overlap a few hours with US Central for the twice-weekly sync.

To apply, send a short note about a similar internal tool you have built. Please do not send a generic agency deck — we will not read it.`,
      url: "https://boards.example.com/halyard-systems/roles/ops-dashboard-contract",
      source: "extension",
      location: "Remote (US / EU overlap with US Central)",
      budgetHint: "$85-100/hr, ~6-10 weeks",
      pipelineStatus: "promoted",
      notes: "Best fit in the pipeline. Stack is an exact match and they name RLS specifically. Ask about the existing schema before quoting.",
      createdAt: ago(1, 3),
      updatedAt: ago(0, 5),
      score: null,
    },
    {
      id: "sample-02",
      title: "Founding Product Engineer (full-time, remote)",
      company: "Tessellate Health",
      description: `Tessellate Health builds scheduling and intake software for small physiotherapy and rehab clinics. We are eleven people, four of them engineers, and we are hiring our fifth. Series A closed last year; we are not pre-revenue and not burning down a runway cliff.

This is a product engineering role, not a ticket-closing role. You will spend real time with clinic staff, watch them use the thing, and have a genuine say in what gets built. Our last three shipped features came from engineers who noticed something during a customer call.

What you would work on:
- Our booking flow, which is the product. Availability logic, cancellations, waitlists, reminders.
- A clinician-facing web app in TypeScript and React, on a Node and Postgres backend.
- Integrations with practice-management systems, most of which have hostile or undocumented APIs.

We care about people who can hold a product argument and a technical one at the same time. Experience owning a surface end to end matters more to us than years of experience. If you have run a small team or led a project, that is relevant; we expect this role to grow into technical leadership within a year or so if that is what you want.

Compensation: $145,000-$180,000 plus meaningful equity, banded by experience and location. Full health cover, four weeks holiday plus public holidays, and a genuine no-questions policy on sick leave.

Location: fully remote within the US, Canada, UK or EU. We do two in-person weeks a year, travel paid.

Our process: a 45-minute conversation, a paid take-home you can do in about four hours, and a half-day with the team. No whiteboard algorithms, no unpaid multi-week projects.`,
      url: "https://boards.example.com/tessellate-health/jobs/founding-product-engineer",
      source: "boards.greenhouse.io",
      location: "Remote — US, Canada, UK, EU",
      budgetHint: "$145k-$180k + equity",
      pipelineStatus: "triage",
      notes: "",
      createdAt: ago(2, 1),
      updatedAt: ago(2, 1),
      score: null,
    },
    {
      id: "sample-03",
      title: "Fixed-scope: clean + dedupe 40k supplier records, one-off",
      company: "Meridian Freight Labs",
      description: `We have a supplier database of roughly 40,000 rows exported from a legacy system that was in use for eleven years. It is a mess and we need it usable before we migrate to a new ERP next quarter.

Concretely, what needs to happen:
- Deduplicate. The same supplier appears up to six times with different spellings, punctuation, and trailing legal suffixes ("Ltd", "Ltd.", "Limited"). Fuzzy matching is expected; we will review the merge candidates ourselves.
- Normalise addresses and country codes to ISO 3166.
- Split a single free-text "contact" column into name, email, phone. About 15% of rows have multiple contacts crammed in.
- Flag rows that cannot be resolved automatically, with a reason, so our ops person can fix them by hand.
- Deliver as a documented script plus the cleaned CSV, so we can re-run it when we get the final export.

We do not care what language you use, though Python or Node would be easiest for us to maintain afterwards. We do care that the script is re-runnable and that you explain your matching thresholds — we need to defend the merges to finance.

This is genuinely one-off. There is no ongoing work behind it and we would rather say that plainly than dangle a fake long-term carrot.

Budget: $1,200-$1,800 fixed, depending on approach. Half up front, half on delivery. We would like it inside two weeks but the deadline is soft.

Async is completely fine. We will answer questions in a shared doc within a business day. No standups, no calls unless you want one.`,
      url: "https://boards.example.com/meridian-freight-labs/gigs/supplier-data-cleanup",
      source: "manual",
      location: "Remote — worldwide, async",
      budgetHint: "$1,200-$1,800 fixed",
      pipelineStatus: "triage",
      notes: "",
      createdAt: ago(3, 6),
      updatedAt: ago(3, 6),
      score: null,
    },
    {
      id: "sample-04",
      title: "Build an LLM-backed document triage tool (contract)",
      company: "Northwind Ledger",
      description: `We are a small accountancy practice and we receive several hundred client documents a week by email — receipts, invoices, bank statements, the occasional handwritten note photographed badly. Right now a junior sorts them by hand.

We want a tool that ingests the mailbox, classifies each attachment by document type, extracts a handful of fields (date, amount, currency, counterparty), and drops anything it is not confident about into a human review queue. Confidence handling matters more to us than raw accuracy: a wrong number that looks certain is worse for us than an honest "I don't know".

We have already prototyped this badly ourselves with an off-the-shelf API and it works about 70% of the time, which is not good enough to trust. We would like someone who has actually shipped an LLM feature into production and knows where the sharp edges are — prompt versioning, evaluation, cost control, what to do when the model changes underneath you.

Preferred stack: TypeScript, Next.js for the review UI, Postgres for storage. We are not attached to a particular model provider. Whatever you pick, we need to understand the running cost per thousand documents before we commit.

Engagement: we think this is 4-6 weeks of work. We would prefer a fixed price for a defined first phase (ingest + classify + review queue) with extraction as a second phase, rather than open-ended hourly.

Budget: we have set aside around $18,000 for phase one. If that is unrealistic, tell us — we would rather hear it now.

Remote, UK working hours preferred but not required. We are in Leeds.`,
      url: "https://boards.example.com/northwind-ledger/contract/document-triage",
      source: "news.ycombinator.com",
      location: "Remote (UK hours preferred)",
      budgetHint: "~$18,000 fixed, phase one",
      pipelineStatus: "applied",
      notes: "Applied 4 days ago. Sent the doc-pipeline case study and a phased quote. Follow up Monday if no reply.",
      createdAt: ago(6, 2),
      updatedAt: ago(4),
      score: null,
    },
    {
      id: "sample-05",
      title: "Senior Frontend Engineer — design systems",
      company: "Cobalt & Rye",
      description: `Cobalt & Rye is a direct-to-consumer homeware brand. We have grown fast and our storefront has grown badly with us: three different button components, two competing grid systems, and a checkout nobody wants to touch.

We are hiring a senior frontend engineer to own our design system and drag the storefront back into coherence. You would work closely with our two designers and be the person who decides what a component is.

Day to day:
- Build and document a component library. We use React and TypeScript; the library will be consumed by the storefront and by our internal merchandising tools.
- Improve Core Web Vitals. Our LCP on mobile is embarrassing and it is costing us conversions.
- Accessibility. We have had two complaints and no process. We would like a real one.
- Mentor two mid-level engineers.

We are a commerce company, so seasonality is real: we ship carefully from October through December and more freely the rest of the year.

Stack: React, TypeScript, Next.js on the storefront, Storybook, Tailwind. Backend is Ruby, but you would not be expected to touch it beyond the occasional API tweak.

Salary: £70,000-£85,000 depending on experience, plus bonus. 25 days holiday.

Location: hybrid, two days a week in our London office. We are not able to offer fully remote for this role — the design collaboration is genuinely better in person and we would rather be honest about that than advertise remote and then quietly require attendance.`,
      url: "https://boards.example.com/cobalt-and-rye/careers/senior-frontend-design-systems",
      source: "weworkremotely.com",
      location: "Hybrid — London, 2 days/week onsite",
      budgetHint: "£70k-£85k",
      pipelineStatus: "triage",
      notes: "",
      createdAt: ago(4, 8),
      updatedAt: ago(4, 8),
      score: null,
    },
    {
      id: "sample-06",
      title: "Technical Program Manager, Platform",
      company: "Verdant Grid",
      description: `Verdant Grid operates software for community solar projects. We are about 60 people and our platform team of nine is currently coordinated by whoever shouts loudest, which is not a strategy.

We are looking for a technical program manager to own delivery across the platform group: three squads working on metering ingestion, billing, and the customer portal.

What the job actually is:
- Turning vague executive intent into a sequenced plan the engineers agree is real.
- Running the planning cycle and keeping dependencies between the three squads visible before they bite.
- Being the person who says out loud that a date has slipped, early, with a plan attached.
- Writing the status update leadership reads, in a way that does not require translation.

We want someone technical enough to read a design doc and ask a good question — not someone who only moves tickets. Prior engineering experience is welcome but not required if you can demonstrate the judgement.

You would report to the VP Engineering and work closely with two staff engineers and a product director.

Compensation: $130,000-$155,000 plus equity. Remote within the US, or hybrid from our Denver office if you prefer one.

We will be honest about the hard parts: the metering ingestion codebase is old and the team that wrote it has largely left. Part of this role is helping us plan a rewrite we have been avoiding for two years. If that sounds like a mess, it is, but it is a well-funded and well-intentioned one.`,
      url: "https://boards.example.com/verdant-grid/openings/tpm-platform",
      source: "boards.greenhouse.io",
      location: "Remote — US (or hybrid Denver)",
      budgetHint: "$130k-$155k + equity",
      pipelineStatus: "promoted",
      notes: "Worth a look — heavy on delivery ownership, light on stack. Would need to lean on the PM framing, not the build one.",
      createdAt: ago(5, 4),
      updatedAt: ago(1, 2),
      score: null,
    },
    {
      id: "sample-07",
      title: "Automate our weekly reporting (small async project)",
      company: "Quarry Analytics",
      description: `Small ask, clearly defined. Every Monday someone on our team spends about three hours pulling numbers from four places and pasting them into a slide deck. We would like that to happen by itself.

The four sources:
- A Postgres read replica (we will give you a read-only user).
- A Google Sheet the sales team maintains by hand and will not give up.
- Two REST APIs, both documented, both boring.

The output should be a single dashboard page plus a PDF or slide export we can drop into the Monday meeting. We are not precious about the tool — if the sanest answer is a scheduled script that renders a static page, we will take it.

Requirements that actually matter to us:
- It must fail loudly. If a source is down we want an obvious broken state, not last week's numbers silently repeated.
- It must be handover-able. One page of documentation, and no dependency on a service we would have to explain to our accountant.
- Keep the running cost near zero. We are fine with a cheap VM or a free-tier scheduler.

Budget: $900-$1,400 fixed. Timeline is flexible — we have lived with the manual version for a year, another month will not kill us.

Entirely async. We are in Melbourne, so real-time overlap with most of the world is painful anyway. Questions in email or a shared doc, answered daily.

If you have done something similar before, a link is worth more than a cover letter.`,
      url: "https://boards.example.com/quarry-analytics/projects/weekly-reporting-automation",
      source: "extension",
      location: "Remote — worldwide, fully async",
      budgetHint: "$900-$1,400 fixed",
      pipelineStatus: "triage",
      notes: "",
      createdAt: ago(2, 9),
      updatedAt: ago(2, 9),
      score: null,
    },
    {
      id: "sample-08",
      title: "Full-stack developer — Django / Vue platform",
      company: "Lantern Bay Media",
      description: `Lantern Bay Media runs a network of regional news sites. We are looking for a full-stack developer to join our four-person engineering team and work on our publishing platform.

Our stack is Django (Python) on the backend with Vue 2 on the frontend, sitting on MySQL. Yes, Vue 2. Migrating it is on the roadmap and has been for some time; being realistic, it is unlikely to be a priority in the next year. We would rather tell you that in the advert than in month three.

The work is a mix of new features for our editorial team (scheduling, embargoes, a better media library) and steady maintenance of a codebase that is about eight years old. Roughly 60/40 in favour of new work in a good quarter.

We would like someone comfortable across the stack who does not mind older code and can improve it incrementally rather than demanding a rewrite. Experience with Django specifically is strongly preferred — we do not have the capacity to teach the framework.

Also relevant: our sites carry a lot of traffic during local election cycles and we care a great deal about page performance and caching. Some CDN and cache-invalidation experience would be genuinely useful.

Salary: $95,000-$115,000. Remote within the US, with an optional office in Providence if you like one.

Benefits are decent: full health cover, 20 days holiday, and a genuine four-day week in July and August that we have run for three years.`,
      url: "https://boards.example.com/lantern-bay-media/jobs/fullstack-django-vue",
      source: "weworkremotely.com",
      location: "Remote — US",
      budgetHint: "$95k-$115k",
      pipelineStatus: "triage",
      notes: "",
      createdAt: ago(7, 5),
      updatedAt: ago(7, 5),
      score: null,
    },
    {
      id: "sample-09",
      title: "React Developer — long-term contract, immediate start",
      company: "Orbit Provisions",
      description: `Required location: Germany only (Berlin metro preferred).

We are a US-based logistics startup building out our Berlin engineering hub and we are hiring React developers for long-term contracts through our EU hiring partner.

The work: building and maintaining customer-facing dashboards in React and TypeScript, working alongside our US product team. Standard modern frontend — component work, state management, API integration, some chart-heavy reporting views.

Requirements:
- 3+ years React and TypeScript.
- Strong written and spoken English; you will be in daily standups with the US team.
- Must be located in and legally able to contract from Germany. This is a firm requirement of our engagement model and we cannot make exceptions — please do not apply from outside Germany, we will not be able to proceed regardless of how strong your background is.
- Available for a full 40 hours per week with 4 hours of overlap with US Eastern.

Rate: $45-$60 per hour depending on experience, paid monthly in USD through our partner.

We are looking for people who want stability rather than short projects. Our current contractors have been with us between one and three years and we intend to keep growing the team.

Interview process: a screening call with our partner, a technical interview with our US lead, and a short paired exercise.`,
      url: "https://boards.example.com/orbit-provisions/contract/react-developer-berlin",
      source: "manual",
      location: "Germany only — Berlin metro preferred",
      budgetHint: "$22-$30/hr",
      pipelineStatus: "triage",
      notes: "",
      createdAt: ago(3, 11),
      updatedAt: ago(3, 11),
      score: null,
    },
    {
      id: "sample-10",
      title: "Senior Full Stack Engineer (WordPress / PHP)",
      company: "Pelago Robotics",
      description: `Salary: $38,000 - $46,000 per year, depending on experience.

Pelago Robotics is looking for a senior full stack engineer to own our web presence and internal tooling. This is a broad role at a small company and we need someone who can wear a lot of hats.

Responsibilities:
- Maintain and extend our marketing site, built on WordPress with a heavily customised theme and about thirty plugins.
- Custom PHP plugin development for our product configurator.
- Some jQuery work on legacy pages.
- Manage our shared hosting environment, including deployments (currently via FTP) and backups.
- Occasional Photoshop work for landing pages when our designer is busy.
- General IT support for the office — printer issues, laptop setup, mailbox admin.

Requirements:
- 5+ years experience with WordPress and PHP.
- Comfortable working alone; you would be our only web person.
- On-site 5 days a week at our facility. This role cannot be done remotely as you will be supporting office staff directly.
- Willing to be on call for site outages including weekends.

We are a fast-paced environment and we are looking for someone with a startup mentality who is willing to go the extra mile. We work hard and celebrate wins together.

To apply, send your CV and salary expectations. Please note we are unable to sponsor visas at this time.`,
      url: "https://boards.example.com/pelago-robotics/careers/senior-fullstack-wordpress",
      source: "news.ycombinator.com",
      location: "On-site 5 days/week",
      budgetHint: "$38k-$46k/yr",
      pipelineStatus: "ignored",
      notes: "Out of stack, on-site only, on-call weekends, and the salary is roughly a third of target for a 'senior' title. Clear no.",
      createdAt: ago(8, 7),
      updatedAt: ago(8, 1),
      score: null,
    },
  ];
}
