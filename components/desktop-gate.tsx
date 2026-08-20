"use client";

/**
 * The narrow-screen gate.
 *
 * WHY A GATE AND NOT A RESPONSIVE PASS
 * ------------------------------------
 * A responsive pass shipped first — measured at 375px, fixed every truncation
 * and every off-screen tab — and the operator's verdict on a real phone was
 * still "it's really bad… it's never going to work there". He is right, and the
 * reason is not layout:
 *
 * **There is no sync.** The board lives in one browser's local storage, so a
 * phone is not a small window onto your pipeline — it is a second, empty
 * pipeline that happens to look identical. Everything a phone user could do
 * here (pick tracks, triage, capture) either needs the desktop-only plugin or
 * produces data the desktop will never see. Making that fit on 375px is making
 * a dead end comfortable.
 *
 * So below `md` the app is not rendered at all and this stands in its place.
 *
 * WHAT THIS SCREEN STILL HAS TO DO
 * --------------------------------
 * It is now the landing page for every person who taps the link in a post —
 * probably most of them. A bare "Desktop only" wall would answer none of the
 * questions that visit arrives with, so this still says what the product is,
 * in the same plain words as the welcome popup, and gives them a way to carry
 * the link to a real machine. It is a redirect, not a door slam.
 *
 * ⚠️ **There is no "continue anyway", and that was a deliberate reversal.**
 * This screen shipped with one, on the reasoning that somebody might already
 * have a board in this browser and a hard block would strand their data. The
 * operator overruled it on two grounds, both stronger:
 *
 *  1. The product launched days ago and nobody has a board on a phone. The
 *     population the escape hatch protected is empty.
 *  2. A door that opens onto a bad experience is worse than no door. People
 *     take it, see a screen we have already admitted does not work, and judge
 *     the product by that — so the escape hatch does not rescue the visit, it
 *     converts a clean "come back on a laptop" into a bounce.
 *
 * Desktop or not at all. If a mobile app is ever worth building, it gets built.
 *
 * The data is not destroyed by this, only unreachable through the UI: it is
 * still in that browser's local storage under `pursuit.doc`. If somebody ever
 * does turn up stranded, the recovery is to read that key out of devtools, not
 * to put this button back.
 */

import { useState } from "react";

import { Button } from "./ui";

export function DesktopGate() {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
    } catch {
      // No clipboard permission — the address bar still works, and the URL is
      // printed below in full for exactly this case.
      setCopied(false);
    }
  }

  return (
    /* `fixed` rather than a block in the flow, and that is load-bearing.
       The app still mounts underneath (hidden), and its first-run tour locks
       body scroll. A gate that scrolled the body would be frozen by a tour the
       user cannot see. This scrolls itself. */
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-background px-5 py-10 text-foreground">
      <div className="mx-auto max-w-md">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
          Bobi Labs · local-first
        </div>
        <h1 className="text-[26px] font-bold -tracking-[0.02em]">
          Bobi<span className="text-emerald-400">·</span>Pursuit
        </h1>

        <div className="mt-5 rounded-[14px] border border-amber-500/30 bg-amber-500/[0.07] p-4">
          <div className="text-[17px] font-bold text-amber-300">
            This one needs a desktop 💻
          </div>
          <p className="mt-1.5 text-[15px] leading-relaxed text-foreground/90">
            Your board is saved inside one browser on one computer — there is no
            account and nothing on our servers. Opening it here would start a
            second, empty board that your desktop never sees.
          </p>
        </div>

        <p className="mt-5 text-[15px] leading-relaxed text-foreground/90">
          It is a free job hunt tracker. Save postings straight from a job site
          with the browser plugin, see which ones actually fit, and move them
          through applied and interviewing on one board.
        </p>

        <div className="mt-5 rounded-[12px] border border-border bg-card p-4">
          <div className="text-[14px] font-bold">Send it to your computer</div>
          <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
            Open this address on a laptop or desktop and set it up there.
          </p>
          <div className="mt-2.5 select-all break-all rounded-md border border-border bg-muted/40 px-2.5 py-2 font-mono text-[13px] text-foreground">
            pursuit.bobilabs.dev
          </div>
          <div className="mt-2.5">
            <Button size="md" variant="solid" onClick={copyLink}>
              {copied ? "Copied ✓" : "Copy the link"}
            </Button>
          </div>
        </div>

        {/* Where the "continue anyway" link used to be. See the file header —
            it is gone on purpose, and a future session should read that note
            before adding one back. */}
        <p className="mt-6 text-[13px] leading-relaxed text-text-muted">
          Nothing to install and no sign-up — the whole thing runs in a desktop
          browser.
        </p>
      </div>
    </div>
  );
}
