// Signal vocabulary for the free-tier rule scorer.
//
// This file is DATA + three text primitives, nothing else. All judgement lives
// in rule-scorer.ts.
//
// WHAT CHANGED IN v2, and why it matters more than it looks:
//
// This file used to hold three bespoke lexicons — a PM-title regex, a
// fixed-scope deliverable taxonomy, a stack-hit weighting table. Those were one
// person's job search, hardcoded. A designer or a nurse running this app got
// three buckets that could never describe their work.
//
// So the *track-specific* vocabulary is gone from here and now lives in the
// user's own `Profile.keywords` / `Profile.excludeKeywords`, where they can read
// and edit it. What remains below is only the vocabulary that is genuinely
// universal to job hunting regardless of trade: where the work is, whether the
// money was disclosed and what kind of money it is, whether the scope is real,
// whether the posting is stale, and the seniority band of a title.
//
// Two lexicons survive that read job-specific but are not: CONTRACT_FRAMING_TERMS
// and FTE_FRAMING_TERMS describe the *engagement shape* of a posting, which
// every trade has (a nurse can be agency or staff), and the scorer only uses
// them to compare against what the user's own track description asks for.
//
// Rules for anything added here:
//   - No `g` flag on module-level regexes. A shared regex with /g carries
//     `lastIndex` between calls and silently makes scoring non-deterministic.
//   - Lowercase terms only. Every haystack is lowercased before matching.
//   - Terms are matched on word boundaries (see `countTerm`), so "react" does
//     not fire on "reacts" but does fire on "react's" and "(react)".
//   - Nothing trade-specific. If it only makes sense for software, it belongs in
//     a preset in `lib/types.ts`, not here.

// ──────────────────────────────────────────────────────────────────
// Text primitives
// ──────────────────────────────────────────────────────────────────

const WORDISH = /[a-z0-9]/;

// Boundary-aware substring count. Deliberately NOT a RegExp: user-supplied
// keywords ("c++", "node.js", "$/hr") would need escaping, and a
// lookbehind-based boundary regex throws on older Safari — which a downloaded
// static build will absolutely meet.
export function countTerm(haystack: string, term: string): number {
  const t = term.trim().toLowerCase();
  if (!t) return 0;
  let n = 0;
  let i = haystack.indexOf(t);
  while (i !== -1) {
    const before = i > 0 ? haystack[i - 1] : "";
    const after = i + t.length < haystack.length ? haystack[i + t.length] : "";
    if (!WORDISH.test(before) && !WORDISH.test(after)) n++;
    i = haystack.indexOf(t, i + t.length);
  }
  return n;
}

// True when `term` appears in either the raw haystack or its dot-compacted
// twin, so "next.js" matches a post that wrote "nextjs" and vice versa.
export function termHit(haystack: string, compactHaystack: string, term: string): boolean {
  if (countTerm(haystack, term) > 0) return true;
  const compact = term.replace(/[.\s_-]/g, "");
  if (compact.length >= 3 && compact !== term.trim().toLowerCase()) {
    return countTerm(compactHaystack, compact) > 0;
  }
  return false;
}

// Removes dots only BETWEEN alphanumerics ("next.js" -> "nextjs") so word
// boundaries elsewhere survive.
export function compactText(s: string): string {
  return s.replace(/([a-z0-9])\.([a-z0-9])/g, "$1$2");
}

// A posting that says "no unpaid trials", "not a commission-only role" or "no
// on-site requirement" is naming the thing in order to RULE IT OUT. Counting
// that as a deal-breaker hit is the same class of bug as reading "React app, no
// WordPress please" as a WordPress job — and it is expensive, because an
// excluded keyword is the heaviest negative signal in the scorer.
//
// Two words of slack ("no more than", "not currently an") covers the phrasings
// that actually occur without reaching back far enough to catch an unrelated
// clause.
const NEGATED_BEFORE_RE = /\b(no|not|never|without|zero|avoid|excluding)\s+(?:[a-z0-9'-]+\s+){0,2}$/;

/**
 * Like `termHit`, but ignores occurrences the posting has explicitly negated.
 * Used for deal-breaker terms only — a negated *positive* keyword ("no React
 * experience needed") is a much rarer construction and reads fine either way.
 */
export function unnegatedTermHit(
  haystack: string,
  compactHaystack: string,
  term: string,
): boolean {
  if (scanUnnegated(haystack, term)) return true;
  const compact = term.replace(/[.\s_-]/g, "");
  if (compact.length >= 3 && compact !== term.trim().toLowerCase()) {
    return scanUnnegated(compactHaystack, compact);
  }
  return false;
}

function scanUnnegated(haystack: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  let i = haystack.indexOf(t);
  while (i !== -1) {
    const before = i > 0 ? haystack[i - 1] : "";
    const after = i + t.length < haystack.length ? haystack[i + t.length] : "";
    if (!WORDISH.test(before) && !WORDISH.test(after)) {
      if (!NEGATED_BEFORE_RE.test(haystack.slice(Math.max(0, i - 40), i))) {
        return true;
      }
    }
    i = haystack.indexOf(t, i + t.length);
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────
// Geography (ported from the private hybrid scorer — load-bearing)
// ──────────────────────────────────────────────────────────────────

// SAMPLE default, deliberately region-neutral: set YOUR regions in settings.
// Eligibility is always judged against the user's own list, never against any
// built-in opinion about regions. A posting whose "Required location:" line
// names none of the user's regions (and is not openly remote/global) is capped
// at 25 on every track, because a requirement the user cannot meet is a
// requirement, wherever it points. Rate concerns are handled by the money
// rules, not by geography.
export const DEFAULT_ELIGIBLE_LOCATIONS = [
  "remote", "worldwide", "anywhere", "global",
];

export const REQUIRED_LOCATION_RE =
  /(?:required\s+)?(?:candidate\s+)?location[:\s]+([^\n|]+)/i;

export const OPEN_LOCATION_RE =
  /\b(remote|worldwide|anywhere|global|americas|north\s*america)\b/;

// ──────────────────────────────────────────────────────────────────
// Money framing
// ──────────────────────────────────────────────────────────────────

// "this money is a yearly salary" markers.
export const ANNUAL_CONTEXT_RE =
  /(per\s+year|\/\s*yr\b|\/\s*year\b|annually|annual\b|a\s+year|p\.?a\.?\b|salary|compensation|base\s+pay)/i;

// "this money is a project budget" markers. Presence of these DISABLES the
// annual reading — the bug this fixes: "$12k-$18k for the build" on a 6-week
// MVP was read as an $8.65/hr salary and hard-rejected a 92-fit job.
export const PROJECT_CONTEXT_RE =
  /(for\s+the\s+(?:build|project|mvp|work)|fixed[-\s]?(?:price|budget|fee)?|per\s+project|project\s+budget|total\s+budget|one[-\s]?time|retainer|\/\s*project)/i;

export const HOURLY_CONTEXT_RE = /(\/\s*h(?:r|our)?\b|per\s+hour|an\s+hour|hourly|\bhr\b)/i;

// Bid-farming / cheapest-wins language.
export const RACE_TO_BOTTOM_TERMS = [
  "lowest price", "lowest bid", "lowest rate", "cheapest", "cheap developer",
  "cheap dev", "low budget", "tight budget", "very small budget", "limited budget",
  "beginner developer", "student developer", "budget is limited",
  "best price wins", "bid low", "no agencies please low",
  "long term work for the right price", "willing to work for less",
];

// ──────────────────────────────────────────────────────────────────
// Engagement shape — how the POSTING frames the work
//
// Universal across trades. The scorer never rewards or punishes a shape on its
// own; it only compares what the posting is against what the user's own track
// description asked for.
// ──────────────────────────────────────────────────────────────────

export const CONTRACT_FRAMING_TERMS = [
  "contract", "contractor", "contract role", "freelance", "freelancer",
  "consultant", "consulting", "1099", "statement of work", "sow",
  "project-based", "project based", "short-term project", "short term project",
  "fixed-price", "fixed price", "per project", "day rate", "independent contractor",
  "locum", "agency shift", "engagement",
];

export const FTE_FRAMING_TERMS = [
  "full-time", "full time", "fte", "salary", "salaried", "benefits", "401k",
  "health insurance", "pto", "paid time off", "equity", "stock options",
  "permanent", "employee", "annual leave", "perks", "career growth",
  "our team is growing", "join our team",
];

// A bounded one-off. Generic on purpose: "fixed fee" and "single deliverable"
// mean the same thing to a translator, an illustrator and a data engineer.
export const FIXED_SCOPE_RE =
  /\b(fixed[-\s]?price|fixed[-\s]?scope|fixed\s+fee|one[-\s]?off|one[-\s]?time|small\s+(?:project|task|job)|quick\s+(?:task|job|gig|turnaround)|per\s+project|flat\s+(?:fee|rate)|micro[-\s]?task|single\s+deliverable|by\s+the\s+piece)\b/i;

// ──────────────────────────────────────────────────────────────────
// Seniority — of a TITLE
// ──────────────────────────────────────────────────────────────────

export const SENIOR_TITLE_RE =
  /\b(senior|sr\.?|staff|principal|lead|group|head|director|vp|vice\s+president|chief|founding|executive|consultant)\b/i;

export const JUNIOR_TITLE_RE =
  /\b(associate|junior|jr\.?|intern|internship|entry[-\s]level|graduate|trainee|apprentice|assistant)\b/i;

// ──────────────────────────────────────────────────────────────────
// Intent — what the USER'S OWN TRACK DESCRIPTION asks for
//
// Read off `${name} ${short} ${description}`. Small, high-precision lists: a
// false positive here mislabels an entire track, so these terms only appear in
// prose that is genuinely declaring an engagement shape or a seniority band.
// ──────────────────────────────────────────────────────────────────

export const INTENT_CONTRACT_TERMS = [
  "contract", "contracts", "contracting", "contractor", "freelance",
  "freelancing", "freelancer", "consulting", "consultant", "project-based",
  "project based", "day rate", "gig", "gigs", "1099", "statement of work",
  "locum", "self-employed",
];

export const INTENT_FULLTIME_TERMS = [
  "full-time", "full time", "fte", "salaried", "salary", "permanent",
  "staff role", "employee", "in-house", "in house", "w2", "perm",
  "employment", "employed",
];

export const INTENT_FIXED_TERMS = [
  "fixed-scope", "fixed scope", "fixed-price", "fixed price", "fixed fee",
  "one-off", "one off", "one-time", "deliverable", "deliverables",
  "micro", "small project", "small projects", "short task", "async gig",
  "bounded",
];

export const INTENT_SENIOR_RE =
  /\b(senior|staff|principal|lead|leadership|head\s+of|director|vp|chief|founding|executive|experienced|seasoned)\b/i;

export const INTENT_JUNIOR_RE =
  /\b(junior|entry[-\s]level|graduate|internship|intern|trainee|apprentice|associate|first\s+job|early\s+career|career\s+chang(?:e|er|ing)|breaking\s+into)\b/i;

// ──────────────────────────────────────────────────────────────────
// Scope / timeline / freshness
// ──────────────────────────────────────────────────────────────────

export const CLEAR_SCOPE_RE =
  /(deliverable|scope\s+of\s+work|acceptance\s+criteria|requirements?\s+(?:doc|document|are|list)|milestone|spec(?:ification)?\b|wireframe|figma|user\s+stories|brief\b|we\s+(?:have|already\s+have)\s+(?:designs|a\s+spec|wireframes|the\s+schema)|api\s+docs?)/i;

// Concrete countable deliverable ("40k rows", "300 PDFs", "12 articles") — the
// strongest clear-scope tell there is, and the reason short posts aren't
// automatically vague.
export const CONCRETE_QUANTITY_RE =
  /\b\d[\d,]*\s*[km]?\+?\s*(rows|records|pages|files|products|skus|listings|urls|links|pdfs|images|photos|contacts|leads|entries|endpoints|articles|posts|items|invoices|documents|words|slides|screens|components|episodes|clients|patients)\b/i;

export const VAGUE_SCOPE_RE =
  /(\btbd\b|to\s+be\s+discussed|we'?ll\s+(?:discuss|figure)|not\s+sure\s+(?:what|how|yet)|ideas?\s+welcome|open\s+to\s+suggestions|need\s+help\s+with\s+everything|do\s+it\s+all|various\s+tasks|misc(?:ellaneous)?\s+tasks|wear\s+many\s+hats|and\s+much\s+more)/i;

export const URGENT_TIMELINE_RE =
  /\b(asap|immediately|by\s+today|by\s+tomorrow|overnight|within\s+(?:24|48)\s*hours|same[-\s]day|by\s+end\s+of\s+(?:day|week)|this\s+weekend|rush)\b/i;

export const BIG_SCOPE_RE =
  /\b(platform|marketplace|multi[-\s]tenant|end[-\s]to[-\s]end|full[-\s]stack\s+app|mobile\s+app|complete\s+(?:system|application|rewrite)|saas|rebrand|full\s+campaign)\b/i;

export const FAST_DECISION_RE =
  /(start\s+(?:immediately|asap|right\s+away|this\s+week|monday)|immediate\s+start|ready\s+to\s+hire|hiring\s+(?:asap|immediately|now)|quick\s+(?:decision|hire)|interview(?:s|ing)?\s+this\s+week|decision\s+by\s+|can\s+start\s+(?:today|tomorrow|monday))/i;

export const POSTED_AGO_RE =
  /\bposted\s+(?:about\s+|over\s+|more\s+than\s+|around\s+)?(\d{1,3})\+?\s*(day|week|month|year)s?\s+ago\b/i;

export const POSTED_AGO_WORDY_RE =
  /\bposted\s+(?:a|an|one)\s+(month|year)\s+ago\b/i;

// ──────────────────────────────────────────────────────────────────
// Stopwords
//
// Used when turning a track's prose description into matchable domain tokens.
// Everything here is career boilerplate, framing vocabulary the scorer already
// handles separately, or a word so common that "matching" on it is noise.
// ──────────────────────────────────────────────────────────────────

export const TEXT_STOPWORDS = new Set([
  // ── common English ──
  "about", "above", "after", "again", "against", "along", "already", "also",
  "although", "always", "among", "another", "anyone", "anything", "around",
  "back", "because", "become", "been", "before", "behind", "being", "below",
  "between", "beyond", "both", "came", "come", "comes", "coming", "could",
  "does", "doing", "done", "down", "during", "each", "either", "else", "enough",
  "especially", "even", "ever", "every", "everything", "find", "first",
  "following", "found", "from", "further", "gets", "getting", "give", "given",
  "gives", "going", "gone", "have", "having", "here", "how", "however", "into",
  "itself", "just", "keep", "kept", "last", "later", "least", "less", "lets",
  "like", "likely", "little", "long", "look", "lots", "made", "mainly", "many",
  "maybe", "mean", "means", "might", "more", "most", "mostly", "much", "must",
  "near", "never", "next", "nothing", "often", "once", "only", "onto", "other",
  "others", "ours", "over", "part", "perhaps", "plenty", "quite", "rather",
  "ready", "really", "right", "said", "same", "says", "seen", "self", "several",
  "shall", "should", "since", "some", "something", "sometimes", "soon", "sort",
  "still", "such", "sure", "than", "that", "their", "them", "then", "there",
  "these", "they", "thing", "things", "think", "this", "those", "though",
  "three", "through", "thus", "together", "took", "toward", "towards", "under",
  "until", "upon", "usually", "very", "want", "wants", "ways", "well", "went",
  "were", "what", "when", "where", "whether", "which", "while", "whole", "whom",
  "whose", "will", "with", "within", "without", "would", "your", "yours",
  "actually", "genuinely", "increasingly", "instead", "stuff", "wrote",
  "write", "written", "exist", "exists", "existing", "front", "close", "apps",
  // ── generic career vocabulary ──
  "years", "year", "work", "works", "working", "worked", "team", "teams",
  "using", "used", "build", "building", "built", "ship", "ships", "shipped",
  "shipping", "role", "roles", "jobs", "posting", "postings", "hire", "hiring",
  "hired", "apply", "applying", "candidate", "candidates", "company",
  "companies", "experience", "experienced", "skills", "responsibilities",
  "requirements", "required", "preferred", "opportunity", "opportunities",
  "career", "position", "positions", "people", "person", "someone",
  "senior", "junior", "level", "levels", "title", "titles", "seat",
  // ── role nouns: that is what `keywords` are for ──
  "product", "products", "engineer", "engineers", "engineering", "developer",
  "developers", "development", "designer", "designers", "manager", "managers",
  "management", "analyst", "analysts", "director", "leader", "leaders",
  "leadership", "founder", "founders", "staff", "stack", "systems", "system",
  "software", "technical", "technology", "tech",
  // ── framing the scorer scores separately ──
  "contract", "contracts", "contractor", "freelance", "freelancing", "full",
  "time", "salary", "salaried", "permanent", "remote", "hybrid", "onsite",
  "office", "rate", "rates", "hourly", "budget", "paid", "scope", "scoped",
  "deliverable", "deliverables", "async",
  // ── verbs of wanting ──
  "wanting", "need", "needs", "needed", "looking", "seek", "seeking", "prefer",
  "prefers", "open", "interested", "take", "takes", "taking", "care", "cares",
  "make", "makes", "good", "great", "best", "real", "kind", "help", "helps",
  "helping",
]);
