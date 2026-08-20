"use client";

/**
 * "What is this, and how does it work?"
 *
 * One explainer, two surfaces: the "How it works" tab at `/howitworks/`, and a
 * sheet reachable from the header on every other tab. Both render the same
 * words, because a product that explains itself differently in two places is a
 * product with two stories.
 *
 * The panel used to hang off the bottom of Overview instead of owning a tab.
 * Moving it did not fork it — `Body` is still the only description of this
 * product anywhere, and the header sheet still reaches it from wherever you are,
 * because a route is a worse answer than a button when you are mid-triage.
 *
 * The tone rule here is the whole point: **say what it does not do, first and
 * plainly.** This tier cannot scrape job boards, and the reason is physics
 * rather than a paywall — a page in your browser cannot fetch a job board
 * cross-origin, and the boards block datacenter IPs, so a "free scraper" would
 * have to be a server we do not have. Anyone who finds that out in week two
 * feels lied to; anyone who reads it in minute one feels told.
 *
 * Nothing here reads `window` during render. The bookmarklet needs an origin, so
 * it is built in an effect and written onto a real `<a href>` afterwards.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  Button,
  ColorBadge,
  MoreInfo,
  PanelCard,
  PanelHeader,
  SectionLabel,
  Sheet,
  cx,
} from "./ui";
import {
  CHROME_EXTENSION_URL,
  FIREFOX_EXTENSION_URL,
} from "@/lib/app-config";

/**
 * Which browser is this, as far as the install buttons need to care.
 *
 * Client-only and deliberately `null` on the first render: this app is a static
 * export, so the component runs once in Node at build time where there is no
 * user agent. Guessing a browser there would bake one into the HTML and hand
 * every other browser a hydration mismatch. `null` renders both stores, which
 * is also the honest answer for anything that is neither.
 *
 * Sniffing at all is a deliberate exception. The rule against it exists because
 * feature detection is more truthful, but "which extension store can this user
 * install from" is not a feature — Firefox and Chrome expose no API that says
 * which storefront serves them, and the alternative is showing everyone two
 * buttons and making them work out which is theirs.
 *
 * Order matters: Edge, Opera and Brave all carry "Chrome" in their UA, and
 * Chrome's UA also carries "Safari". Firefox is checked first because it is the
 * only unambiguous one.
 */
type Flavour = "firefox" | "chrome" | null;

function useBrowserFlavour(): Flavour {
  const [flavour, setFlavour] = useState<Flavour>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/firefox|fxios/i.test(ua)) setFlavour("firefox");
    else if (/chrome|chromium|crios|edg[/]/i.test(ua)) setFlavour("chrome");
  }, []);
  return flavour;
}

/* ─────────────────────────────── Pieces ─────────────────────────────── */

function Prose({ children }: { children: ReactNode }) {
  return (
    <p className="text-[14px] leading-relaxed text-muted-foreground">{children}</p>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>;
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 font-mono text-[12px] font-bold text-emerald-400">
        {n}
      </span>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{title}</div>
        <div className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The three routes a job can take into this app, in order of how good they are.
 *
 * Reused verbatim by onboarding — there is exactly one description of capture in
 * this product, and it lives here.
 */
export function CaptureRoutes({ compact = false }: { compact?: boolean }) {
  const [origin, setOrigin] = useState("");
  const linkRef = useRef<HTMLAnchorElement>(null);

  // Browser-only, so: effect, never render.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Built as a string and attached via the DOM rather than written as a JSX
  // `href` literal — a `javascript:` scheme in source is a lint and static
  // analysis magnet, and this still works as a real draggable bookmark.
  const bookmarklet = origin
    ? `javascript:(function(){var s=(window.getSelection?String(window.getSelection()):'').slice(0,11000);var q=new URLSearchParams({add:'1',t:document.title.slice(0,300),u:location.href,d:s,s:location.hostname});window.open('${origin}/?'+q.toString(),'_blank');})();`
    : "";

  useEffect(() => {
    if (linkRef.current && bookmarklet) {
      linkRef.current.setAttribute("href", bookmarklet);
    }
  }, [bookmarklet]);

  const flavour = useBrowserFlavour();

  /* The two store cards, ordered so the user's own browser leads.
   *
   * Both are always rendered. Hiding the other store would be a worse bug than
   * it looks: people install on the laptop they browse on and read the docs on
   * whatever is open, and a Firefox user reading this on Chrome must still be
   * able to find the Firefox build. Ordering solves the "which is mine" problem
   * without taking the other one away. */
  const stores = [
    {
      key: "chrome",
      name: "Chrome",
      also: "Edge, Brave, Arc",
      href: CHROME_EXTENSION_URL,
    },
    {
      key: "firefox",
      name: "Firefox",
      also: null,
      href: FIREFOX_EXTENSION_URL,
    },
  ];
  if (flavour === "firefox") stores.reverse();

  return (
    <div className="grid gap-2.5">
      {/* ── the front door, and on a first visit the only door worth reading ── */}
      <div className={cx("grid gap-2.5", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
        {stores.map((store, i) => {
          const isYours = flavour === store.key;
          return (
            <PanelCard
              key={store.key}
              className={cx(
                isYours || (flavour === null && i === 0)
                  ? "border-emerald-500/25 bg-emerald-500/[0.04]"
                  : undefined,
              )}
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-[14px] font-bold">{store.name}</span>
                {isYours ? (
                  <ColorBadge tone="green">your browser</ColorBadge>
                ) : null}
              </div>
              <Prose>
                {store.name === "Chrome"
                  ? "A side panel. Open a posting, click capture."
                  : "A sidebar. Open a posting, click capture."}
              </Prose>
              <div className="mt-2.5">
                <a
                  href={store.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  Install for {store.name} ↗
                </a>
                {store.also ? (
                  <div className="mt-1.5 text-[12px] text-text-muted">
                    Also {store.also}.
                  </div>
                ) : null}
              </div>
            </PanelCard>
          );
        })}
      </div>

      {/* ── everything else, folded away ──
          The operator's note was that offering three equal routes made the page
          read as a menu when only one of them is good, and he is right that the
          extension is the product. These are demoted rather than deleted: the
          bookmarklet is the only route on Safari, on mobile, and on a locked-down
          work machine that forbids extensions, and "By hand" is not a competing
          route at all — it documents the + Capture a job button that sits in the
          header on every tab regardless. Removing it from the page would not
          remove it from the app, it would just leave a button nothing explains. */}
      <MoreInfo label="Not on Chrome or Firefox? Two other ways in">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <PanelCard>
            <div className="mb-1.5 text-[14px] font-bold">Bookmarklet</div>
            <Prose>
              No install, any browser. Select the description on a job page and
              click the bookmark.
            </Prose>
            <div className="mt-2.5">
              <a
                ref={linkRef}
                href="#"
                onClick={(e) => e.preventDefault()}
                draggable
                title="Drag this to your bookmarks bar"
                className="inline-flex cursor-grab items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                ⬆ Capture to Pursuit
              </a>
              <div className="mt-1.5 text-[14px] leading-snug text-text-muted">
                Drag it to your bookmarks bar. Clicking it here does nothing on
                purpose — it only means something on a job page.
              </div>
            </div>
          </PanelCard>

          <PanelCard>
            <div className="mb-1.5 text-[14px] font-bold">By hand</div>
            <Prose>
              <Strong>+ Capture a job</Strong> in the header. Paste a title and
              the posting text; everything else is optional.
            </Prose>
          </PanelCard>
        </div>
      </MoreInfo>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group border-b border-border last:border-b-0">
      {/* Same marker and rotation as `MoreInfo`, deliberately. Three different
          disclosure glyphs had grown across the app for one interaction, which
          the operator spotted as two boxes "trying to achieve the same thing"
          that did not look alike. The row layout stays different because a list
          of questions is not a standalone expander — it is the marker that has
          to be common, not the container. */}
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2.5 text-[14px] font-semibold text-foreground">
        <span className="inline-block text-[11px] text-muted-foreground transition-transform group-open:rotate-90">
          ▶
        </span>
        {q}
      </summary>
      <div className="pb-3 pl-5 text-[14px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

/* ─────────────────────────────── Content ─────────────────────────────── */

function Body({ dense = false }: { dense?: boolean }) {
  return (
    <div className="space-y-5">
      {/* First, and it used to be last.
          This tab is where the tour's "Start using it" drops you, and the
          operator's note was that the plugin links were not on the page. They
          were — at the bottom, under five sections of prose, which for a person
          who has just been told to start is the same as not being there. The
          install is the only thing on this page that is an action; everything
          below it is reference. */}
      <section>
        <SectionLabel>Getting jobs in</SectionLabel>
        <CaptureRoutes compact={dense} />
      </section>

      <section>
        <SectionLabel>What this is</SectionLabel>
        <Prose>
          A job pipeline that lives in <Strong>this browser</Strong>. Capture
          postings from anywhere; it scores each against tracks you define,
          collapses duplicates, and boards them so you decide once. No account,
          no server — which is also why there is nothing to cancel.
        </Prose>
      </section>

      <section>
        <SectionLabel>How it works</SectionLabel>
        <div className="space-y-2.5">
          <Step n={1} title="You define what you are looking for">
            A <Strong>track</Strong> is one thing you would take: “contract dev
            work”, “night shifts within an hour of home”. Your words, your
            keywords, up to five. This app ships no opinion about what job you
            want.
          </Step>
          <Step n={2} title="Jobs come in by capture, not by crawl">
            The extension, the bookmarklet or the add form. Every route is a
            deliberate click on a page you are already reading.
          </Step>
          <Step n={3} title="Each job is scored per track, and shows its working">
            One number per track, with the signals behind it. A posting that is a
            90 for contract work is a 20 for a salaried role — averaging those
            hides the only interesting thing in the room.
          </Step>
          <Step n={4} title="You triage on the board">
            Triage → Promoted → Applied → Interviewing, with Declined and
            Skipped out of the way. Nothing moves on its own: it cannot know you
            sent something or that anyone replied, so it never claims you did.
          </Step>
        </div>
      </section>

      <section>
        <SectionLabel>What it does not do</SectionLabel>
        <div className="space-y-2">
          <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/[0.06] p-3">
            <div className="text-[14px] font-semibold text-amber-300">
              It cannot scrape job boards. That is physics, not a paywall.
            </div>
            <div className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
              A page in your browser cannot fetch another site’s HTML — blocked
              cross-origin — and the boards block datacenter IPs. The workaround
              is a server we deliberately do not have. Any free tool claiming
              otherwise is running that server, or reading a feed already shut
              off.
            </div>
          </div>
          <Prose>
            It also does not write applications, email anyone, remind you, or sync
            between devices. It is triage.
          </Prose>
        </div>
      </section>

      <section>
        <SectionLabel>Where your data goes</SectionLabel>
        <Prose>
          Nowhere. It is in this browser’s local storage and there is no server to
          send it to — watch the network tab stay empty. So:{" "}
          <Strong>clearing your browser data deletes your pipeline</Strong>, and
          an export is the backup. An Anthropic key is stored here too, sent only
          to Anthropic, and stripped from every export.
        </Prose>
      </section>

      <section>
        <SectionLabel>What the next steps add</SectionLabel>
        <div className={cx("grid gap-2.5", dense ? "grid-cols-1" : "md:grid-cols-3")}>
          <PanelCard className="border-emerald-500/30">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[14px] font-bold">This tier</span>
              <ColorBadge tone="green">free</ColorBadge>
            </div>
            <Prose>
              Capture, dedupe, the board, and rule-based scoring: your keywords
              matched literally, every signal named. Instant, offline, legible.
            </Prose>
          </PanelCard>
          <PanelCard>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[14px] font-bold">Your own API key</span>
              <ColorBadge tone="purple">optional</ColorBadge>
            </div>
            <Prose>
              Claude reads the posting against the <Strong>prose</Strong> you
              wrote and reasons per track — it understands “a seat close to
              engineering” when the posting never says it. Under $0.01 a job,
              billed by Anthropic. Your key never leaves this browser, and we
              bill nothing.
            </Prose>
          </PanelCard>
          <PanelCard>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[14px] font-bold">Self-hosted</span>
              <ColorBadge tone="blue">server</ColorBadge>
            </div>
            <Prose>
              A server does what a browser cannot: scheduled ingestion, a shared
              database across devices, drafted applications, and the{" "}
              <Strong>Sources</Strong>, <Strong>Intelligence</Strong> and{" "}
              <Strong>Stats</Strong> tabs. Those are missing here rather than
              faked — nothing to report on, no outcome history to chart.
            </Prose>
          </PanelCard>
        </div>
      </section>


      {/* Answers to the same handful of questions, folded away.
          The operator floated a whole FAQ tab. A fifth tab is permanent
          navigation weight for content read once, so this sits at the bottom of
          the manual instead — one line each until asked for, and easy to promote
          later if it turns out people hunt for it. */}
      <section>
        <SectionLabel>Common questions</SectionLabel>
        <div className="rounded-[10px] border border-border bg-card px-3.5">
          <Faq q="Do I need an account?">
            No. There is no sign-up and no server of ours to sign up to.
          </Faq>
          <Faq q="Where does my data actually live?">
            In this browser, and nowhere else. <Strong>Export</Strong> in
            Settings is your only backup — clearing your browser data clears the
            pipeline.
          </Faq>
          <Faq q="Do I need an Anthropic key?">
            No. Every job is scored without one. A key only lets Claude read a
            posting you have already captured more carefully.
          </Faq>
          <Faq q="Does it search or scrape job boards for me?">
            No. Nothing arrives on its own and nothing runs while this tab is
            closed. You capture what you are already looking at.
          </Faq>
          <Faq q="Does it apply to jobs for me?">
            No. Applying is a step only you can take.
          </Faq>
          <Faq q="Can I use it on my phone?">
            The bookmarklet works anywhere. The extensions are desktop Chrome and
            Firefox only.
          </Faq>
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────────── Surfaces ─────────────────────────────── */

/**
 * The "How it works" tab. Wears `PanelHeader` like Overview, Pipeline and Job
 * Studio do, so a tab that happens to be prose still reads as the same product.
 *
 * Not `dense`: this is a full-width panel, so the three-across grids get the
 * room they were drawn for. The sheet keeps `dense` because it renders in a
 * column where three cards would each be a sliver.
 */
export function HowItWorksPanel() {
  return (
    <div>
      <PanelHeader
        title="How Bobi·Pursuit works"
        sub="Ninety seconds: what it is, what it will not do, where your data lives, and what the next step up adds. All of it true of the free tier you are using right now."
      />
      <Body />
    </div>
  );
}

/** The header's "How it works" button. */
export function HowItWorksSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      open
      title="How Bobi·Pursuit works"
      subtitle="What it is, what it will not do, and what the next step up adds."
      width="sm:max-w-2xl"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] text-muted-foreground">
            No account, no server, no upload.
          </span>
          <Button size="md" variant="primary" onClick={onClose}>
            Got it
          </Button>
        </div>
      }
    >
      <Body dense />
    </Sheet>
  );
}
