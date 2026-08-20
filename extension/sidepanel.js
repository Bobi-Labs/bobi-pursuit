// Side-panel "sweep cockpit".
//
// Auth: by default there is none, and that is the point. The free
// Bobi-Pursuit app has no accounts and no API, so capture just hands the
// job to the app's own add form. Self-hosters can switch to server mode
// under Advanced; only then do we look for a session — the dashboard's
// cookie (bobi-pursuit-auth) replayed as a Bearer, or a token pasted under
// Advanced. `cookies` is an OPTIONAL permission, so it is normally absent:
// treat "not granted" as plain "not signed in", never as an error.
//
// P2: a live glance — pipeline counts, "already in pipeline?" for the
// tab you're on, a top-to-review queue, and quick Promote/Skip — so a
// manual sweep is a guided loop, not tab-juggling. Server mode only;
// those are all server reads.

const DEFAULT_INSTANCE = "https://pursuit.bobilabs.dev";
const AUTH_COOKIE = "bobi-pursuit-auth";

// Short tags for the best-matched scoring profile.
const PROFILE_TAG = {
  contract_stack: "Stack",
  fte_pm: "PM",
  micro_async: "Micro",
};

const els = {};
[
  "ver", "openBtn",
  "signin", "signinBtn", "recheckBtn", "capture", "tabTitle", "tabUrl",
  "captureBtn", "saveSearchBtn", "result", "gear", "counts", "cTriage", "cPromoted",
  "cDrafted", "dupe", "queue", "queueList",
].forEach((id) => (els[id] = document.getElementById(id)));

// `appMode` picks which Bobi-Pursuit you're capturing into:
//   "local"  — DEFAULT. The free static app: no API and no account exists, so
//              we open its /?add=1&… capture URL and let it prefill its own
//              add form.
//   "server" — an advanced self-hosted deployment: POST to /api/jobs/manual,
//              needs a session or an ingest token, and the job is scored
//              server-side.
// The free tier has no auth at all, which is why the default mode bypasses
// sign-in entirely rather than failing an auth check that can never succeed.
let cfg = { instanceUrl: DEFAULT_INSTANCE, token: "", appMode: "local" };
let summaryTimer = null;

const openOptions = () => chrome.runtime.openOptionsPage();
els.gear.addEventListener("click", openOptions);

async function loadCfg() {
  const s = await chrome.storage.sync.get(["instanceUrl", "token", "appMode"]);
  cfg.instanceUrl = (s.instanceUrl || DEFAULT_INSTANCE).replace(/\/+$/, "");
  cfg.token = (s.token || "").trim();
  // Absent stored value means a fresh install, and a fresh install belongs on
  // the free app — so anything that isn't an explicit opt-in to server mode
  // resolves to "local".
  cfg.appMode = s.appMode === "server" ? "server" : "local";
}

const isLocalMode = () => cfg.appMode === "local";

/** Hostname of a URL, or "extension" if it can't be parsed. Never throws. */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "extension";
  } catch {
    return "extension";
  }
}

/**
 * `cookies` is an OPTIONAL permission — it only means anything in server mode,
 * so a casual user is never prompted for it and it is normally absent. When
 * it's missing `chrome.cookies` may not exist at all, so check before touching
 * it. Never throws: "not granted" is just "not signed in".
 */
async function hasCookieAccess() {
  if (!chrome.cookies || !chrome.permissions) return false;
  try {
    return await chrome.permissions.contains({ permissions: ["cookies"] });
  } catch {
    return false;
  }
}

async function resolveAuth() {
  if (cfg.token) return cfg.token;
  // No cookie access → no session to find. Fall through to "not signed in".
  if (!(await hasCookieAccess())) return null;
  try {
    const c = await chrome.cookies.get({ url: cfg.instanceUrl, name: AUTH_COOKIE });
    if (c && c.value) return c.value;
  } catch (e) {
    console.warn("cookie read:", e);
  }
  return null;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}
const capturable = (u) => !!u && /^https?:\/\//i.test(u);
const fitTone = (n) => (n == null ? "" : n >= 70 ? "ok" : n >= 40 ? "warn" : "err");

/**
 * The page the visible result card is *about*.
 *
 * Without this the card outlived its subject. "Sent to Bobi-Pursuit" is
 * rendered into `els.result`, and `refreshTab` rewrote the title, the URL and
 * the button on every tab change while leaving the result untouched — so after
 * capturing a job and moving on you were looking at some unrelated page's title
 * with a success message from a different page sitting underneath it. The
 * operator's words: it is not clear if it did, or what it thinks it did.
 *
 * Clearing on *every* tab event would be the obvious fix and it is wrong: the
 * `tabs.onUpdated` listener also fires for the page you are already on (a late
 * title, a same-page nav), which would wipe the confirmation a half-second
 * after the capture that earned it. So the card is tied to a URL and clears
 * only when the URL actually changes.
 */
let resultForUrl = null;

/** Pending auto-clear for a transient confirmation. Declared here rather than
 * beside renderFor because clearResult is defined far above it, and a `let`
 * used before its declaration is evaluated is a ReferenceError waiting for the
 * first caller that is not async. */
let resultTimer = 0;

function clearResult() {
  clearTimeout(resultTimer);
  resultForUrl = null;
  els.result.className = "result";
  els.result.innerHTML = "";
}

async function refreshTab() {
  const tab = await activeTab();
  if (!tab) return;
  if (resultForUrl && tab.url !== resultForUrl) clearResult();
  els.tabTitle.textContent = tab.title || "(untitled)";
  els.tabUrl.textContent = tab.url || "";
  const ok = capturable(tab.url);
  els.captureBtn.disabled = !ok;
  els.captureBtn.textContent = ok ? "⬆ Capture this job" : "Can't capture this page";
  // Deliberately NOT gated on `ok`. A search results page is precisely what
  // capture refuses and what is most worth saving.
  const savable = /^https?:/i.test(tab.url || "");
  els.saveSearchBtn.disabled = !savable;
}

async function renderAuthState() {
  // The free app has no accounts and no API — there is nothing to sign in to,
  // so go straight to capture. (The pipeline summary is a server read, so it
  // simply doesn't exist in this mode.)
  if (isLocalMode()) {
    els.signin.style.display = "none";
    els.capture.style.display = "block";
    refreshTab();
    return;
  }
  const bearer = await resolveAuth();
  const authed = !!bearer;
  els.signin.style.display = authed ? "none" : "block";
  els.capture.style.display = authed ? "block" : "none";
  if (authed) {
    refreshTab();
    loadSummary();
  }
}

/* Read from the manifest rather than a constant, so the number shown can
 * never disagree with the package it shipped in. */
try {
  els.ver.textContent = "v" + chrome.runtime.getManifest().version;
} catch {
  // Non-fatal: a missing version line beats a broken panel.
}

els.saveSearchBtn.addEventListener("click", saveSearch);
/* Straight to the app, capturing nothing.
 *
 * Worth its own button once tabs are reused: the panel is now the thing you
 * keep open while job hunting, and "take me to my board" was only reachable by
 * capturing something you did not want. Goes through openInPursuit too, so it
 * raises the existing tab rather than adding to the pile. */
els.openBtn.addEventListener("click", () => {
  void openInPursuit(cfg.instanceUrl);
});
els.signinBtn.addEventListener("click", () => {
  // /login is a server-mode page; the free app has nothing to sign into.
  if (isLocalMode()) return;
  chrome.tabs.create({ url: `${cfg.instanceUrl}/login` });
});
els.recheckBtn.addEventListener("click", renderAuthState);

// Registering this listener at all needs the optional `cookies` permission —
// on a fresh install `chrome.cookies` is undefined and touching it here would
// throw before the panel finished loading. Wire it only once we know we may.
(async () => {
  if (!(await hasCookieAccess())) return;
  chrome.cookies.onChanged.addListener((info) => {
    if (info.cookie && info.cookie.name === AUTH_COOKIE && !info.removed) {
      renderAuthState();
    }
  });
})();
chrome.tabs.onActivated.addListener(onTabChange);
chrome.tabs.onUpdated.addListener((_id, i) => {
  if (i.status === "complete" || i.title) onTabChange();
});
chrome.storage.onChanged.addListener((c, area) => {
  // appMode included: switching between the free app and a self-hosted one
  // changes whether there's anything to sign into at all.
  if (area === "sync" && (c.token || c.instanceUrl || c.appMode)) {
    loadCfg().then(renderAuthState);
  }
});

function onTabChange() {
  refreshTab();
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(loadSummary, 400); // debounce rapid nav
}

// ── cockpit ───────────────────────────────────────────────────────
async function api(path, opts) {
  const bearer = await resolveAuth();
  if (!bearer) return { authMissing: true };
  const resp = await fetch(`${cfg.instanceUrl}${path}`, {
    ...opts,
    headers: { ...(opts && opts.headers), Authorization: `Bearer ${bearer}` },
  });
  if (resp.status === 401) return { unauth: true };
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

async function quickStatus(jobId, status, btn) {
  if (btn) btn.disabled = true;
  const r = await api(`/api/jobs/${jobId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (r.unauth) return toSignin();
  loadSummary();
}

async function loadSummary() {
  // Server-only read. Bail before api() can miss auth and bounce the panel to
  // the sign-in card — a tab switch on the free app must not do that.
  if (isLocalMode()) return;
  const tab = await activeTab();
  const u = tab && capturable(tab.url) ? `?url=${encodeURIComponent(tab.url)}` : "";
  const r = await api(`/api/pipeline/summary${u}`);
  if (r.authMissing || r.unauth) return toSignin();
  if (!r.ok || !r.data) return;
  const { counts, top, dupe } = r.data;

  els.counts.style.display = "flex";
  els.cTriage.textContent = counts.triage ?? "–";
  els.cPromoted.textContent = counts.promoted ?? "–";
  els.cDrafted.textContent = counts.drafted ?? "–";

  // Dedupe banner for the tab you're on.
  if (dupe) {
    const tone = fitTone(dupe.fit);
    const st = dupe.proposal_status || dupe.pipeline_status || "in pipeline";
    els.dupe.style.display = "block";
    els.dupe.innerHTML =
      `<div class="t">✓ Already in your pipeline</div>` +
      `<div class="s">fit <b class="${tone}">${dupe.fit ?? "—"}</b> · ${st}</div>` +
      `<div class="row-actions">` +
      `${dupe.pipeline_status === "triage" ? '<button class="promote" data-act="promote">⚡ Promote</button>' : ""}` +
      `${dupe.pipeline_status !== "ignored" ? '<button data-act="skip">Skip</button>' : ""}` +
      `</div>`;
    els.dupe.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () =>
        quickStatus(dupe.job_id, b.dataset.act === "promote" ? "promoted" : "ignored", b),
      ),
    );
  } else {
    els.dupe.style.display = "none";
  }

  // Top-to-review queue.
  if (top && top.length) {
    els.queue.style.display = "block";
    els.queueList.innerHTML = "";
    top.forEach((it) => {
      const row = document.createElement("div");
      row.className = "qitem";
      const tone = fitTone(it.fit);
      // Under MAX-of-three fit, the number alone is ambiguous — tag the
      // best-matched profile so the operator knows WHY it scored high.
      const tag = PROFILE_TAG[it.best_profile] || "";
      row.innerHTML =
        `<span class="ft ${tone}">${it.fit ?? "—"}</span>` +
        `<span class="tt" title="${(it.title || "").replace(/"/g, "&quot;")}">${it.title || "(untitled)"}</span>` +
        (tag ? `<span class="ptag">${tag}</span>` : "") +
        `<button class="qp">⚡</button>`;
      row.querySelector(".tt").addEventListener("click", () => {
        if (it.url) chrome.tabs.create({ url: it.url });
      });
      row.querySelector(".qp").addEventListener("click", (e) =>
        quickStatus(it.job_id, "promoted", e.target),
      );
      els.queueList.appendChild(row);
    });
  } else {
    els.queue.style.display = "none";
  }
}

// ── capture ───────────────────────────────────────────────────────
//
// Runs INSIDE the page (no extension APIs here). This is the only route
// to the sites the scrapers can't legally or technically reach — and, per
// the 2026-07 source probe, the ONLY route to micro_async gigs at all:
// fixed-scope work (data cleaning, scraping, doc conversion, ETL, QA
// scripting) lives on gig marketplaces, and every marketplace is
// either dead to us (Upwork RSS 410) or hostile (Reddit 403s everything).
//
// Ordered most-specific → least. First match wins, so a site-specific
// container beats the generic <main> fallback. Selection always wins over
// all of it — if the operator highlights the JD, we trust that.
function extractJob() {
  // Single-line fields: collapse everything. Right for a title or a company.
  const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

  /* The posting body, which must NOT be flattened.
   *
   * `clip` collapses \s+ — newlines included — so every capture arrived as one
   * unbroken wall of text. The app renders the description with
   * `whitespace-pre-wrap` and always has; there was simply nothing left to
   * render by the time it got there.
   *
   * Collapses runs of spaces and tabs, keeps single newlines, and squeezes
   * three-or-more blank lines down to one. */
  const clipBody = (s, n) =>
    (s || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, n);
  const meta = (p) =>
    document.querySelector(`meta[property="${p}"],meta[name="${p}"]`)?.content || "";

  const JD_SELECTORS = [
    // LinkedIn (logged-in + logged-out variants)
    "#job-details",
    ".jobs-description__content",
    ".jobs-box__html-content",
    ".show-more-less-html__markup",
    ".description__text",
    // Upwork — micro_async + contract gigs
    '[data-test="Description"]',
    '[data-test="job-description-text"]',
    "section.air3-card-section .break",
    // Contra
    '[data-testid="opportunity-description"]',
    // Reddit (r/forhire, r/jobbit) — browsable by a human, not by us
    '[data-test-id="post-content"]',
    "shreddit-post .md",
    ".usertext-body .md",
    // Indeed / Glassdoor (human-browsable only)
    "#jobDescriptionText",
    ".jobDescriptionContent",
    // Wellfound / AngelList
    '[data-test="JobDescription"]',
    // RemoteOK — nothing matched here, which is how a capture ended up with
    // forty other companies' listings in it. Microdata rather than a class,
    // so it also picks up any other board using schema.org attributes.
    '[itemprop="description"]',
    "div.markdown",
    // Generic ATS embeds
    "#content .section-wrapper",
    ".job-description",
    ".jobDescription",
    // Generic fallbacks
    "article",
    "[role='main']",
    "main",
  ];

  const titleFromDom = () => {
    const h =
      document.querySelector(".job-details-jobs-unified-top-card__job-title") || // LinkedIn
      document.querySelector('[data-test="job-title"]') ||                        // Upwork
      document.querySelector("h1");
    return h ? clip(h.innerText, 300) : "";
  };

  const title = clip(titleFromDom() || meta("og:title") || document.title, 300);

  /* Company and pay.
   *
   * The app has accepted `c` and `b` capture params, and shown company and
   * budget fields on its add form, since the beginning — this extractor simply
   * never filled them, so every capture arrived with two blanks the user then
   * typed by hand off the page they were already looking at.
   *
   * Read from schema.org JobPosting first. Most boards emit it as JSON-LD for
   * Google for Jobs, which makes it the one structured, non-scraped description
   * of the posting sitting right there in the page the user opened. Falls back
   * to og:site_name and the hostname, which are worse but never wrong enough to
   * matter — the user reviews everything on the add form before saving. */
  /* Every JobPosting on the page, then the one this page is actually about.
   *
   * Taking the first match was the original approach and it is a coin flip on
   * any board that lists related jobs: this posting on RemoteOK carries **51**
   * JobPosting blocks, fifty of them other people's vacancies. The right one
   * happened to be first there, which is exactly the kind of luck that holds
   * until it does not — and the failure would be silent and specific, filing a
   * capture under the wrong company at the wrong salary.
   *
   * So candidates are scored against the page's own headline. An exact title
   * match wins; otherwise the first is used, which is no worse than before. */
  const jobPostings = (() => {
    const out = [];
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(node.textContent || "");
      } catch {
        continue; // one malformed block must not cost the rest of the page
      }
      // @graph, bare arrays and single objects all occur in the wild.
      const items = Array.isArray(data) ? data : data && data["@graph"] ? data["@graph"] : [data];
      for (const item of items) {
        if (item && item["@type"] === "JobPosting") out.push(item);
      }
    }
    return out;
  })();

  const jobPosting = (() => {
    if (jobPostings.length <= 1) return jobPostings[0] || null;
    const norm = (v) => clip(v, 200).toLowerCase().replace(/[^a-z0-9 ]/g, "");
    const heading = norm(
      document.querySelector("h1")?.innerText ||
        meta("og:title") ||
        document.title,
    );
    if (heading) {
      const exact = jobPostings.find((j) => norm(j.title) && norm(j.title) === heading);
      if (exact) return exact;
      // Headings are routinely decorated — "Remote X (~$350k) at Co" wraps the
      // plain title — so containment counts, longest title first so a short
      // generic one cannot win by being a substring of everything.
      const byLength = [...jobPostings].sort(
        (a, b) => norm(b.title).length - norm(a.title).length,
      );
      const contained = byLength.find((j) => {
        const t = norm(j.title);
        return t.length > 6 && heading.includes(t);
      });
      if (contained) return contained;
    }
    return jobPostings[0];
  })();

  const orgName = (org) => {
    if (!org) return "";
    if (typeof org === "string") return org;
    if (Array.isArray(org)) return orgName(org[0]);
    return org.name || "";
  };

  const company = clip(
    orgName(jobPosting && jobPosting.hiringOrganization) ||
      document.querySelector(".job-details-jobs-unified-top-card__company-name")?.innerText ||
      document.querySelector('[data-test="employer-name"]')?.innerText ||
      meta("og:site_name") ||
      location.hostname.replace(/^www\./, ""),
    120,
  );

  /* Pay, as a human-readable hint rather than a parsed number.
   * The app's field is called budgetHint and its scorer reads prose, so
   * "$120,000 - $150,000 per year" is more useful to it than a float would be —
   * and a currency the app guessed wrong is worse than a string it can read. */
  const budgetHint = (() => {
    const salary = jobPosting && jobPosting.baseSalary;
    const value = salary && (salary.value || salary);
    if (!value) return "";
    const unit = String(value.unitText || "").toLowerCase();
    const period =
      unit === "year" ? "/yr" : unit === "month" ? "/mo" :
      unit === "week" ? "/wk" : unit === "day" ? "/day" :
      unit === "hour" ? "/hr" : "";
    const cur = (salary.currency || value.currency || "").toString().toUpperCase();
    /* Zero means UNDISCLOSED, not free.
     *
     * Boards emit `minValue: 0, maxValue: 0` constantly for postings with no
     * published band — WeWorkRemotely does it on most listings, and the first
     * real page this was tested against produced "USD 0-0/yr". That is worse
     * than an empty field in both directions: the user sees a number that is
     * not true, and the rule scorer reads budgetHint as prose, so a
     * disclosed-looking zero would drag the money signals down on a job whose
     * pay is simply unknown. */
    const pos = (n) => {
      const v = Number(n);
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    const fmt = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const loN = pos(value.minValue);
    const hiN = pos(value.maxValue);
    const oneN = pos(value.value);
    if (loN === null && hiN === null && oneN === null) return "";
    const range =
      loN !== null && hiN !== null && hiN !== loN
        ? fmt(loN) + "-" + fmt(hiN)
        : fmt(oneN !== null ? oneN : loN !== null ? loN : hiN);
    return clip(`${cur ? cur + " " : ""}${range}${period}`, 80);
  })();

  /* The publisher's own description, when the page states one.
   *
   * This is the same structured block the company and salary come from, and it
   * is strictly better than scraping the rendered page: no nav, no "related
   * jobs", no "Upgrade to Premium" — the capture that prompted this arrived
   * with forty other companies' listings appended to it, because no selector
   * matched and the extractor fell back to document.body.
   *
   * A user's own SELECTION still wins, because selecting text is an explicit
   * instruction and the whole product is built on not overriding those. */
  const ldDescription = (() => {
    const raw = jobPosting && typeof jobPosting.description === "string"
      ? jobPosting.description
      : "";
    if (!raw) return "";
    // schema.org allows HTML here and most boards use it.
    const text = raw
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    return clipBody(text, 11000);
  })();

  const selection = String(window.getSelection ? window.getSelection() : "");
  let body = selection;
  let via = "selection";

  // Order: your selection, then the publisher's own structured description,
  // then the per-site selectors, then the page body as a last resort.
  if (clip(body, 40).length < 40 && ldDescription.length >= 200) {
    body = ldDescription;
    via = "json-ld";
  }

  if (clip(body, 40).length < 40) {
    via = "fallback";
    for (const sel of JD_SELECTORS) {
      const el = document.querySelector(sel);
      const text = el ? clip(el.innerText, 11000) : "";
      // 200 chars = a real JD, not a nav blob or an empty shell.
      if (text.length >= 200) {
        body = el.innerText;
        via = sel;
        break;
      }
    }
    if (clip(body, 40).length < 40) {
      body = document.body ? document.body.innerText : "";
      via = "body";
    }
  }

  return {
    title,
    company,
    budgetHint,
    url: location.href,
    description: clipBody(body, 11000),
    usedSelection: via === "selection",
    via,
  };
}

function render(html, cls) {
  els.result.className = "result show " + (cls || "");
  els.result.innerHTML = html;
}

/**
 * A result that clears itself.
 *
 * Only for confirmations. Errors stay until something replaces them — a message
 * telling you what went wrong must not vanish while you are reading it.
 */
function renderFor(html, cls, ms) {
  clearTimeout(resultTimer);
  render(html, cls);
  resultTimer = window.setTimeout(clearResult, ms);
}
function toSignin() {
  // There is no sign-in on the free app, so never strand a local-mode user on
  // a card whose only button opens a server-mode /login page.
  if (isLocalMode()) return;
  els.capture.style.display = "none";
  els.signin.style.display = "block";
}

/**
 * Hand the CURRENT page's address to the app as a saved search.
 *
 * Same mechanism as capture and for the same reason: the extension and the app
 * are different origins, so the extension cannot write to the app's storage. It
 * opens a URL the app knows how to read. No API, no account, nothing posted
 * anywhere.
 *
 * The label is seeded from the page title because that is usually the query in
 * readable form — "product manager remote jobs in London" — and the user can
 * rename it in the app. Better a decent guess they edit than an empty box.
 */
/**
 * Open a Bobi-Pursuit URL, reusing the tab if one is already there.
 *
 * Capturing ten jobs used to open ten tabs. Each handoff called
 * `chrome.tabs.create` unconditionally, which is right exactly once — the first
 * time, when nothing is open — and wrong every time after, and a job hunt is
 * nothing but times after.
 *
 * **On reusing a tab with an unsaved form in it.** The one thing this can
 * destroy is a capture you opened and then abandoned without pressing Save &
 * score. That is the correct thing to lose: you are, at that moment, deliberately
 * capturing something else, and the app now states plainly that nothing is saved
 * until you press the button. Silently keeping the abandoned one and opening
 * an eleventh tab would be the worse trade.
 *
 * The tab is focused rather than updated in the background, and that is not a
 * detail. The handoff is not finished — there is a form waiting for a keypress
 * — so putting it behind the window you are reading would recreate the exact
 * problem the "One step left" card exists to prevent.
 */
async function openInPursuit(url) {
  /* Compare parsed ORIGINS, not string prefixes.
   *
   * `url.startsWith(instanceUrl)` looks equivalent and is not: it also matches
   * `pursuit.bobilabs.dev.example.com`, so a page someone else controls could
   * absorb the handoff while the real app never opens. Cheap to get right, and
   * the wrong version fails in a way nobody would think to test for.
   *
   * The path is deliberately ignored — the app is one tab that may be sitting
   * on any of its routes. */
  let origin = null;
  try {
    origin = new URL(cfg.instanceUrl).origin;
  } catch {
    // A malformed instance URL means no reuse, not a broken capture.
  }
  try {
    const tabs = origin ? await chrome.tabs.query({}) : [];
    const existing = tabs.find((t) => {
      if (!t.url) return false;
      try {
        return new URL(t.url).origin === origin;
      } catch {
        return false;
      }
    });
    if (existing && existing.id != null) {
      await chrome.tabs.update(existing.id, { url, active: true });
      // A tab in another window is focused but invisible until the window is.
      if (existing.windowId != null) {
        try {
          await chrome.windows.update(existing.windowId, { focused: true });
        } catch {
          // Firefox can refuse this without a user gesture. The tab is still
          // the active one in its window, so the handoff is not lost.
        }
      }
      return;
    }
  } catch {
    // A query failure must not cost the capture — fall through and open one.
  }
  await chrome.tabs.create({ url });
}

async function saveSearch() {
  els.saveSearchBtn.disabled = true;
  try {
    const tab = await activeTab();
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
      throw new Error("This page can't be saved.");
    }
    const q = new URLSearchParams({
      savesearch: "1",
      u: tab.url,
      t: (tab.title || "").slice(0, 120),
      s: hostOf(tab.url),
    });
    await openInPursuit(`${cfg.instanceUrl}/?${q.toString()}`);
    renderFor(
      // Same correction as capture: the handoff opens a form, it does not save.
      '<div class="big todo">One step left</div>' +
        '<div class="sub">Opened in your Bobi-Pursuit tab. Name it and press ' +
        "<b>Save</b> on the Searches tab.</div>",
      "todo",
      9000,
    );
  } catch (e) {
    render(
      '<div class="big warn">Could not save</div><div class="sub">' +
        (e && e.message ? e.message : "Unknown error") +
        "</div>",
      "warn",
    );
  } finally {
    els.saveSearchBtn.disabled = false;
  }
}

async function capture() {
  els.captureBtn.disabled = true;
  els.captureBtn.textContent = "Capturing…";
  render('<div class="sub">Extracting + scoring…</div>', "");
  try {
    const bearer = isLocalMode() ? "local" : await resolveAuth();
    if (!bearer) return toSignin();
    const tab = await activeTab();
    if (!tab || !capturable(tab.url)) throw new Error("This page can't be captured.");

    const [{ result: job } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJob,
    });
    if (!job || job.description.length < 20) {
      throw new Error("Couldn't read enough text. Select the job description and retry.");
    }

    // Free app: no API to POST to. Hand the job over via its capture URL —
    // the app prefills its add form and the user confirms there. Same params
    // the bookmarklet uses, so both routes stay in sync.
    if (isLocalMode()) {
      // `c` and `b` have been in the app's CAPTURE_PARAMS all along; this is
      // the first build that actually sends them.
      const q = new URLSearchParams({
        add: "1",
        t: job.title || "",
        u: job.url || "",
        d: job.description || "",
        c: job.company || "",
        b: job.budgetHint || "",
        s: hostOf(job.url),
      });
      await openInPursuit(`${cfg.instanceUrl}/?${q.toString()}`);
      // Brief, then gone. In local mode the capture finishes in a NEW TAB that
      // is now in front of the user, so this panel's confirmation is telling
      // them something they can already see — and it used to sit there
      // indefinitely, still claiming a send while they browsed on. Long enough
      // to catch if the tab opened behind; short enough never to become a lie.
      /* "Sent to Bobi-Pursuit" was a lie, and a specific one: in local mode
       * nothing is saved here at all. The extension opens the app's add form
       * with the fields filled in, and the job only exists once the user
       * presses Save & score in that tab. The operator hit it immediately —
       * capture, read "Sent", close the tab, and the job was never on the
       * board.
       *
       * The review step itself is right and stays: extraction guesses, and a
       * mangled description saved silently is worse than one you glanced at.
       * What was wrong was the sentence claiming the guess had already been
       * accepted. */
      renderFor(
        '<div class="big todo">One step left</div>' +
          '<div class="sub">Opened in your Bobi-Pursuit tab. It is <b>not saved</b> ' +
          "until you press <b>Save &amp; score</b> there.</div>",
        "todo",
        9000,
      );
      return;
    }

    const r = await api("/api/jobs/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: job.title,
        url: job.url,
        description: job.description,
        source_label: "extension",
      }),
    });
    if (r.unauth || r.authMissing) {
      toSignin();
      const p = els.signin.querySelector("p");
      if (p) p.textContent = "Your session expired. Sign in again to keep capturing.";
      return;
    }
    if (!r.ok) {
      render(`Error: ${(r.data && r.data.error) || r.status}`, "err");
      return;
    }
    if (r.data.dedup) {
      render('<div class="big warn">Already in your pipeline</div><div class="sub">Skipped — captured before.</div>', "warn");
    } else {
      const s = r.data.scored;
      if (s) {
        const tone = fitTone(s.fit_score);
        render(
          `<div class="big ${tone}">Added · fit ${s.fit_score}</div>` +
            `<div class="sub"><span class="pill ${tone}">${s.fit_score}</span> ` +
            `${s.employment_type} · ~${Math.round(s.complexity_hours)}h</div>` +
            `<div class="sub">${(s.reasoning || "").slice(0, 220)}</div>` +
            `<div class="sub">${job.usedSelection ? "Captured your selection." : `Auto-detected the description (${job.via}).`}</div>`,
          tone,
        );
      } else {
        render('<div class="big ok">Added to pipeline</div><div class="sub">Scoring queued.</div>', "ok");
      }
    }
    loadSummary(); // refresh counts + dedupe right away
  } catch (e) {
    render(`Error: ${e.message}`, "err");
  } finally {
    els.captureBtn.disabled = false;
    refreshTab();
  }
}

els.captureBtn.addEventListener("click", capture);

(async () => {
  await loadCfg();
  await renderAuthState();
})();
