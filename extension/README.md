# Bobi-Pursuit — Capture (browser extension)

One click captures the job posting you're looking at into Bobi-Pursuit, so
you never retype a listing again.

By default it captures into the **free app at https://pursuit.bobilabs.dev** —
no account, no API key, nothing to paste. Capture reads the page, then opens
the app with the title, URL and description already filled into its add form;
you review and save there.

Click-to-capture only. No background crawling, no pagination, no auth-gated
scraping — it reads only the page you explicitly capture, only when you click
the button. The extractor knows the job-description containers for LinkedIn,
Upwork, Contra, Reddit, Indeed, Glassdoor and Wellfound, and falls back to the
page's main content everywhere else. Tip: select the description text first
for the cleanest capture.

## Install

Both listings are public. This is the way to install it:

- **Chrome, Edge, Brave, Arc** — <https://chromewebstore.google.com/detail/imeiijihiifnfdancfojmelbnfpmfllb>
- **Firefox** — <https://addons.mozilla.org/en-US/firefox/addon/bobi-pursuit-capture/>

Then browse to a job and hit **⬆ Capture this job**.

Firefox has no side-panel API, so the panel isn't docked there; the extension
feature-detects it and capture behaves identically either way.

## Running from source

Only needed if you are changing the extension. Installing from the store is the
normal path, and this section led the README until the listings went public on
2026-08-14 — leaving it in front was walking every reader through a developer
flow to reach something that is one click.

**Chrome / Edge**

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.

**Firefox**

1. `about:debugging` → **This Firefox** → **Load Temporary Add-on…**
2. Pick `manifest.json` inside this `extension/` folder.

A temporary add-on is unloaded when Firefox restarts — reload it the same way.

## How it works

- `manifest.json` — MV3. `scripting`, `storage`, `tabs` and `sidePanel`
  (Chrome only; Firefox ignores it), with `cookies` optional. Plus
  `host_permissions: <all_urls>`, so the panel can read the active tab on
  click — and nothing else.
- `background.js` — opens the capture panel from the toolbar icon.
- `sidepanel.*` — tracks the active tab, extracts title / URL /
  selection-or-main-content, hands it to the app.
- `options.*` — instance URL and mode, stored in `chrome.storage.sync`.

## Self-hosting (advanced)

⚙ → **Advanced** switches the extension from the free app to your own
deployment: set the instance URL and change the mode to **server**. In that
mode capture `POST`s to your instance's `/api/jobs/manual` and the job is
scored server-side, so the panel can also show pipeline counts and flag jobs
you've already saved. You'll need a running Bobi-Pursuit server for this;
most people don't, and the default free mode never talks to an API at all.

### The `cookies` optional permission

`cookies` is **optional and never requested at startup** — install and use the
extension without ever granting it.

It exists for one job in self-hosted mode: reading the `bobi-pursuit-auth`
session cookie *on your own instance*, so signing into your deployment in a
normal tab is enough and there's no token to copy-paste. If you never grant
it, the extension simply treats you as not signed in — nothing throws and
capture keeps working. In the default free mode no cookie is read, because
there is no account to read one for.

Self-hosters who'd rather not grant it can paste a `MANUAL_INGEST_TOKEN` under
⚙ → **Advanced** instead.
