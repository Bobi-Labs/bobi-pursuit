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
  PanelCard,
  PanelHeader,
  SectionLabel,
  Sheet,
  cx,
} from "./ui";

/**
 * Where the browser extension lives.
 *
 * This used to deep-link into a private repository, which was wrong three ways
 * for a public build: the link 404s for every visitor, the URL carried an
 * internal name that must not appear on a public surface, and it advertised
 * the private tree's existence. Points at the product page instead, which is
 * public, already live, and stays correct wherever the extension ends up.
 */
const EXTENSION_URL =
  "https://github.com/Bobi-Labs/bobi-pursuit/tree/main/extension";

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

  return (
    <div className={cx("grid gap-2.5", compact ? "grid-cols-1" : "md:grid-cols-3")}>
      {/* ── the front door ── */}
      <PanelCard className="border-emerald-500/25 bg-emerald-500/[0.04]">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-[14px] font-bold">Browser extension</span>
          <ColorBadge tone="green">best</ColorBadge>
        </div>
        <Prose>
          A side panel in Chrome, a sidebar in Firefox. Open a posting, click
          capture, and it reads the description out of the page for you — it
          knows the layout of the big boards and falls back to your selection
          anywhere else.
        </Prose>
        <ol className="mt-2 space-y-1 text-[14px] leading-relaxed text-muted-foreground">
          <li>
            <span className="font-mono text-[12px] text-foreground">1</span>{" "}
            Download the{" "}
            <a
              href={EXTENSION_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-primary hover:underline"
            >
              extension/ folder ↗
            </a>{" "}
            from the repo.
          </li>
          <li>
            <span className="font-mono text-[12px] text-foreground">2</span>{" "}
            <span className="font-mono text-[12px]">chrome://extensions</span> →
            Developer mode → <Strong>Load unpacked</Strong> → pick that folder.
          </li>
          <li>
            <span className="font-mono text-[12px] text-foreground">3</span> Open
            its ⚙ options, choose <Strong>Free app</Strong>, and set the instance
            URL to{" "}
            <span className="break-words font-mono text-[12px] text-foreground">
              {origin || "this page's address"}
            </span>
            .
          </li>
        </ol>
      </PanelCard>

      {/* ── the no-install route ── */}
      <PanelCard>
        <div className="mb-1.5 text-[14px] font-bold">Bookmarklet</div>
        <Prose>
          No install, works in any browser. Select the description on a job page,
          then click the bookmark — the add form opens pre-filled.
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

      {/* ── the always-available route ── */}
      <PanelCard>
        <div className="mb-1.5 text-[14px] font-bold">By hand</div>
        <Prose>
          <Strong>+ Capture a job</Strong> in the header. Paste a title and the
          posting text; everything else is optional. It is scored the moment you
          save it, and the same URL twice is the same card.
        </Prose>
      </PanelCard>
    </div>
  );
}

/* ─────────────────────────────── Content ─────────────────────────────── */

function Body({ dense = false }: { dense?: boolean }) {
  return (
    <div className="space-y-5">
      <section>
        <SectionLabel>What this is</SectionLabel>
        <Prose>
          A job pipeline that lives in <Strong>this browser</Strong>. You capture
          postings from wherever you find them; it scores each one against tracks
          you define, deduplicates the same job arriving from three sites, and
          gives you a board with four columns so you decide once instead of
          re-reading. There is no account, no server and no database — which is
          also why there is nothing to cancel.
        </Prose>
      </section>

      <section>
        <SectionLabel>How it works</SectionLabel>
        <div className="space-y-2.5">
          <Step n={1} title="You define what you are looking for">
            A <Strong>track</Strong> is one thing you would take: “contract dev
            work”, “senior PM at a product company”, “night shifts within an
            hour of home”. You write the description in your own words and list
            the keywords that actually appear in those postings. Up to five, and
            they are yours — this app ships no opinion about what job you want.
          </Step>
          <Step n={2} title="Jobs come in by capture, not by crawl">
            The extension, the bookmarklet or the add form. Every route is a
            deliberate click on a page you are already reading.
          </Step>
          <Step n={3} title="Each job is scored per track, and shows its working">
            One number per track, plus the exact list of signals that produced
            it. The headline fit is the best of them — a posting that is a 90 for
            contract work really is a 20 for a salaried role, and averaging those
            would hide the only interesting thing in the room.
          </Step>
          <Step n={4} title="You triage on the board">
            Triage → Promoted → Applied, with Ignored out of the way. Nothing
            moves on its own: the software has no way to know you sent something,
            so it never claims you did.
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
              A page running in your browser is not allowed to fetch another
              site’s HTML — the browser blocks it cross-origin — and the boards
              block datacenter IPs, so the usual workaround (a proxy server)
              would need a server we deliberately do not have. Any free tool that
              claims otherwise is either running that server for you, or reading
              a feed that has already been shut off. Capture is how jobs get in
              here, and it is honest about being manual.
            </div>
          </div>
          <Prose>
            It also does not write your applications, email anybody, remind you of
            anything, or sync between your laptop and your phone. It has no
            opinion about your CV. It is triage.
          </Prose>
        </div>
      </section>

      <section>
        <SectionLabel>Where your data goes</SectionLabel>
        <Prose>
          Nowhere. Everything is in this browser’s local storage, and there is no
          server to upload it to — you can watch the network tab stay empty. Two
          consequences worth stating: <Strong>clearing your browser data deletes
          your pipeline</Strong> (an export is the backup), and if you set an
          Anthropic key it is stored here too, sent only to Anthropic, and
          stripped out of every export.
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
              Capture, dedupe, the board, and rule-based scoring: your keywords,
              matched literally, with every signal named. Instant, offline, and
              you can read exactly why a number came out the way it did.
            </Prose>
          </PanelCard>
          <PanelCard>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[14px] font-bold">Your own API key</span>
              <ColorBadge tone="purple">optional</ColorBadge>
            </div>
            <Prose>
              Claude reads the posting against the <Strong>prose</Strong> you
              wrote and writes its own reasoning per track — it understands “a
              seat close to engineering” when the posting never says those words.
              Under $0.01 a job, billed to you by Anthropic, key never leaves this
              browser. Nothing is billed by us; there is no subscription here.
            </Prose>
          </PanelCard>
          <PanelCard>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[14px] font-bold">Self-hosted</span>
              <ColorBadge tone="blue">server</ColorBadge>
            </div>
            <Prose>
              A real backend does what a browser cannot: scheduled scrapers on a
              cron, a shared database across your devices, drafted applications,
              and the <Strong>Sources</Strong>, <Strong>Intelligence</Strong> and{" "}
              <Strong>Stats</Strong> tabs. Those tabs are missing here rather than
              faked — there is no scraper to report on and no outcome history to
              chart.
            </Prose>
          </PanelCard>
        </div>
      </section>

      <section>
        <SectionLabel>Getting jobs in</SectionLabel>
        <CaptureRoutes compact={dense} />
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
