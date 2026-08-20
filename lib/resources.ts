/**
 * The resources directory — everything a job hunt needs that is not a job.
 *
 * Same shape as `job-sites.ts` on purpose: one `Directory` component renders
 * both tabs, so adding a third list later costs a data file and nothing else.
 *
 * Curation rules, which are the whole value:
 *
 *  - **`cost` is stated, and "freemium" is not a synonym for free.** The most
 *    common way these lists waste someone's time is sending them to a tool
 *    whose useful half is paywalled after they have invested an hour. If the
 *    free tier is two scans a month, the weakness says two scans a month.
 *  - **Weaknesses are never softened**, including for the good ones. Free
 *    government guidance is still UK-only; a respected CV guide is still
 *    written for American conventions and students.
 *  - **UK and US are both covered deliberately.** Notice periods, employment
 *    rights, salary norms and CV conventions differ enough that a US-only list
 *    is actively misleading to half the audience.
 *
 * Every URL here was HTTP-checked. Sites that block automated agents (Glassdoor,
 * Ask a Manager, Jobscan, the US Department of Labor) answer 403 to a script and
 * open fine in a browser — that is a bot rule, not a dead link.
 */

export type ResourceCost = "free" | "freemium" | "paid";

export interface Resource {
  name: string;
  url: string;
  category: string;
  blurb: string;
  strengths: string[];
  weaknesses: string[];
  cost: ResourceCost;
}

export const RESOURCE_CATEGORIES: string[] = ["cv","strategy","salary","interview","writing","skills","rights","research"];

export const RESOURCE_CATEGORY_LABEL: Record<string, string> = {
  cv: "CV & résumé",
  writing: "Cover letters",
  interview: "Interviews",
  salary: "Pay & negotiation",
  strategy: "Strategy",
  skills: "Skills",
  research: "Company research",
  rights: "Your rights",
};

export const COST_LABEL: Record<ResourceCost, string> = {
  free: "Free",
  freemium: "Free tier",
  paid: "Paid",
};

export const RESOURCES: Resource[] = [
  {
    name: "Europass CV",
    url: "https://europa.eu/europass/en/create-europass-cv",
    category: "cv",
    blurb: "The EU's free CV builder, exportable and accepted across European applications.",
    strengths: ["Genuinely free with no paywall at export", "Standard format European employers and public bodies recognise"],
    weaknesses: ["Rigid template that reads as bureaucratic outside Europe", "Poor fit for creative or startup applications"],
    cost: "free",
  },
  {
    name: "Google Docs resume templates",
    url: "https://docs.google.com/document/u/0/?ftv=1&tgif=d",
    category: "cv",
    blurb: "Free, clean templates that export to PDF and never trap your file.",
    strengths: ["No account upsell, no watermark, no export fee", "Easy to keep several tailored versions side by side"],
    weaknesses: ["Templates are common enough that recruiters see them constantly", "Complex layouts can confuse applicant tracking systems"],
    cost: "free",
  },
  {
    name: "Jobscan ATS checker",
    url: "https://www.jobscan.co/",
    category: "cv",
    blurb: "Compares your CV against a job description and scores the keyword overlap.",
    strengths: ["Makes the tailoring gap concrete instead of guesswork", "Explains which ATS systems parse which formats"],
    weaknesses: ["Free tier is a couple of scans a month, then it is a subscription", "Encourages keyword-stuffing if you follow its score too literally"],
    cost: "freemium",
  },
  {
    name: "Resume Worded",
    url: "https://resumeworded.com/",
    category: "cv",
    blurb: "Automated CV and LinkedIn critique with line-by-line rewrite suggestions.",
    strengths: ["Catches weak verbs and missing metrics quickly", "LinkedIn review is more useful than the CV one"],
    weaknesses: ["Most substantive feedback sits behind the paid tier", "Advice is generic and skews American"],
    cost: "freemium",
  },
  {
    name: "Harvard CV and cover letter guide",
    url: "https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/",
    category: "cv",
    blurb: "A free university careers guide with annotated before-and-after examples.",
    strengths: ["Free PDF with real annotated examples rather than platitudes", "Strong on turning duties into measurable achievements"],
    weaknesses: ["US conventions throughout — no photo, one page, no date of birth", "Aimed at students, so light on senior and career-change material"],
    cost: "free",
  },
  {
    name: "Overleaf CV templates",
    url: "https://www.overleaf.com/latex/templates/tagged/cv",
    category: "cv",
    blurb: "LaTeX CV templates that produce typographically excellent PDFs.",
    strengths: ["Output looks markedly better than a word processor", "Version control and reuse across tailored variants"],
    weaknesses: ["LaTeX is a real learning curve for a document you edit rarely", "Some templates parse badly in applicant tracking systems"],
    cost: "freemium",
  },
  {
    name: "Ask a Manager",
    url: "https://www.askamanager.org/",
    category: "strategy",
    blurb: "Two decades of blunt, specific answers about applying, interviewing and quitting.",
    strengths: ["Unusually honest about what hiring managers actually think", "Searchable archive covers nearly every awkward situation"],
    weaknesses: ["Blog format makes it hard to read systematically", "US-centric on notice periods, references and salary norms"],
    cost: "free",
  },
  {
    name: "80,000 Hours career guide",
    url: "https://80000hours.org/career-guide/",
    category: "strategy",
    blurb: "A free, research-heavy guide to choosing work that is worth doing.",
    strengths: ["Rigorous about career capital and what actually predicts satisfaction", "Free, long-form and updated"],
    weaknesses: ["Strong effective-altruism framing that will not suit everyone", "Aimed at long-range planning, not at getting hired next month"],
    cost: "free",
  },
  {
    name: "Levels.fyi",
    url: "https://www.levels.fyi/",
    category: "salary",
    blurb: "Crowd-sourced compensation data by company and level, heavy on tech.",
    strengths: ["Breaks out base, bonus and equity rather than one blended figure", "Level mapping across companies is genuinely useful in negotiation"],
    weaknesses: ["Thin outside tech and outside the US", "Self-reported and skewed upward by who bothers to report"],
    cost: "free",
  },
  {
    name: "Glassdoor salary research",
    url: "https://www.glassdoor.com/Salaries/index.htm",
    category: "salary",
    blurb: "Self-reported salary ranges searchable by role, company and location.",
    strengths: ["Broad role coverage well beyond tech, including admin and ops", "Company-level data sits next to reviews"],
    weaknesses: ["Wide ranges and stale entries on smaller employers", "Pushes you to contribute your own salary to see more"],
    cost: "free",
  },
  {
    name: "PayScale",
    url: "https://www.payscale.com/",
    category: "salary",
    blurb: "Salary benchmarking that adjusts for experience, location and skills.",
    strengths: ["Better than most for non-tech and mid-market roles", "Personal report factors in your actual experience"],
    weaknesses: ["Requires a long questionnaire before showing your report", "Sells to employers, so read the framing with that in mind"],
    cost: "free",
  },
  {
    name: "Candor negotiation guide",
    url: "https://candor.co/guides/salary-negotiation",
    category: "salary",
    blurb: "A free, specific walkthrough of negotiating an offer, with scripts.",
    strengths: ["Actual wording to use, not just 'know your worth'", "Covers competing offers and exploding deadlines honestly"],
    weaknesses: ["Written around US tech offers with equity", "Company behind it wants you in its funnel"],
    cost: "free",
  },
  {
    name: "Pramp",
    url: "https://www.pramp.com/",
    category: "interview",
    blurb: "Free peer-to-peer mock interviews, you interview someone then they interview you.",
    strengths: ["Genuinely free and the reciprocity keeps it stocked", "Practising out loud with a stranger is the point"],
    weaknesses: ["Peer quality varies enormously", "Almost entirely technical and product roles"],
    cost: "free",
  },
  {
    name: "Interviewing.io",
    url: "https://interviewing.io/",
    category: "interview",
    blurb: "Anonymous mock interviews with engineers from large tech companies.",
    strengths: ["Interviewers are working engineers, and the feedback is specific", "Recordings let you hear how you actually sound"],
    weaknesses: ["Free access is limited; real use is paid", "Software engineering only"],
    cost: "freemium",
  },
  {
    name: "STAR method guide (MindTools)",
    url: "https://www.mindtools.com/a2bqxb0/star-interview-method",
    category: "interview",
    blurb: "How to structure a competency answer so it lands in under two minutes.",
    strengths: ["The single most transferable interview skill, explained briefly", "Applies to every sector, not just corporate roles"],
    weaknesses: ["Rigid if recited mechanically — interviewers notice", "Some of the site sits behind a membership"],
    cost: "free",
  },
  {
    name: "Big Interview practice questions",
    url: "https://resources.biginterview.com/behavioral-interviews/behavioral-interview-questions/",
    category: "interview",
    blurb: "A large bank of behavioural questions with worked example answers.",
    strengths: ["Broad role coverage including admin, healthcare and management", "Examples show structure rather than scripts to memorise"],
    weaknesses: ["The practice platform itself is paid", "Example answers are polished to the point of sounding fake"],
    cost: "freemium",
  },
  {
    name: "Hemingway Editor",
    url: "https://hemingwayapp.com/",
    category: "writing",
    blurb: "Pastes in your cover letter and marks every sentence that is too dense.",
    strengths: ["Free in the browser with nothing to install or sign up for", "Ruthless about the passive voice that makes cover letters limp"],
    weaknesses: ["Judges readability only — it cannot tell you if the content is right", "Over-simplifies technical writing if you obey it blindly"],
    cost: "free",
  },
  {
    name: "LanguageTool",
    url: "https://languagetool.org/",
    category: "writing",
    blurb: "Grammar and style checking that works in British English, not just American.",
    strengths: ["Handles UK spelling and punctuation properly", "Free tier is generous and there is no account wall to try it"],
    weaknesses: ["Weaker than paid rivals on tone and rephrasing", "Longer documents need the premium tier"],
    cost: "freemium",
  },
  {
    name: "GOV.UK — CV and cover letter advice",
    url: "https://nationalcareers.service.gov.uk/careers-advice/cv-sections",
    category: "cv",
    blurb: "The UK National Careers Service guide to CV sections and cover letters.",
    strengths: ["Free, plain-English and correct for UK conventions", "Covers career gaps and changing sector without judgement"],
    weaknesses: ["Basic — little for senior or specialist applications", "UK only"],
    cost: "free",
  },
  {
    name: "National Careers Service skills assessment",
    url: "https://nationalcareers.service.gov.uk/skills-assessment",
    category: "strategy",
    blurb: "A free UK government tool suggesting roles based on your skills and interests.",
    strengths: ["Genuinely free with no upsell or data harvesting", "Useful when changing sector and unsure what transfers"],
    weaknesses: ["Suggestions are broad and sometimes obvious", "UK labour market only"],
    cost: "free",
  },
  {
    name: "LinkedIn Learning",
    url: "https://www.linkedin.com/learning/",
    category: "skills",
    blurb: "Video courses across software, business and admin, often free via a library card.",
    strengths: ["Many UK and US public libraries give free full access", "Certificates post directly to your profile"],
    weaknesses: ["Course quality is uneven and some material is dated", "Full price is poor value if you are paying yourself"],
    cost: "paid",
  },
  {
    name: "freeCodeCamp",
    url: "https://www.freecodecamp.org/",
    category: "skills",
    blurb: "A free, complete curriculum for web development with real projects.",
    strengths: ["Free forever with no upsell, and the certifications are respected enough", "Project-based, so you finish with portfolio pieces"],
    weaknesses: ["Web development only", "Self-directed, so completion rates are brutal without a plan"],
    cost: "free",
  },
  {
    name: "Coursera",
    url: "https://www.coursera.org/",
    category: "skills",
    blurb: "University and employer courses, most auditable free without the certificate.",
    strengths: ["Audit mode gives full course content at no cost", "Strong in data, project management and healthcare admin"],
    weaknesses: ["Certificates cost money and carry limited weight alone", "Constant nudging toward paid subscriptions"],
    cost: "freemium",
  },
  {
    name: "Notion job search template",
    url: "https://www.notion.com/templates/category/job-search",
    category: "strategy",
    blurb: "Free templates for tracking applications, contacts and interview prep.",
    strengths: ["Useful for the parts a pipeline tool does not cover, like contacts", "Free tier is enough for personal use"],
    weaknesses: ["Overlaps what you are already doing here — do not run two trackers", "Template quality varies wildly by author"],
    cost: "freemium",
  },
  {
    name: "ACAS — UK employment rights",
    url: "https://www.acas.org.uk/",
    category: "rights",
    blurb: "ACAS: free, authoritative UK guidance on contracts, notice and unfair treatment.",
    strengths: ["The definitive free source on UK employment rights", "Free helpline, and early conciliation before a tribunal"],
    weaknesses: ["UK only", "Written for disputes, so hard to skim preventively"],
    cost: "free",
  },
  {
    name: "US Department of Labor — worker rights",
    url: "https://www.dol.gov/general/topic/wages",
    category: "rights",
    blurb: "Official US guidance on wages, overtime and classification as a contractor.",
    strengths: ["Authoritative on contractor-versus-employee classification", "Free and covers state-level variation"],
    weaknesses: ["Dense government prose", "US only, and state rules still need separate checking"],
    cost: "free",
  },
  {
    name: "Blind",
    url: "https://www.teamblind.com/",
    category: "research",
    blurb: "Anonymous employee forum, useful for what a company is actually like inside.",
    strengths: ["Candid about layoffs, management and real compensation", "Fast signal on a company's current state"],
    weaknesses: ["Toxic and status-obsessed in places; read for facts not tone", "Heavily tech and heavily US"],
    cost: "free",
  },
  {
    name: "Companies House",
    url: "https://find-and-update.company-information.service.gov.uk/",
    category: "research",
    blurb: "Free UK company filings — check a prospective employer is solvent and real.",
    strengths: ["Authoritative accounts, directors and filing history, free", "Catches a company filing late or shrinking before you join it"],
    weaknesses: ["Small companies file abbreviated accounts that reveal little", "UK registered companies only"],
    cost: "free",
  },
  {
    name: "Interview Warmup (Google)",
    url: "https://grow.google/certificates/interview-warmup/",
    category: "interview",
    blurb: "A free tool that transcribes your spoken answers and flags patterns.",
    strengths: ["Free, no account needed, and speaking aloud is the exercise", "Highlights filler words and repeated terms you cannot hear yourself"],
    weaknesses: ["Feedback is mechanical — it does not judge whether the answer is good", "Question banks are limited to a few fields"],
    cost: "free",
  },
];
