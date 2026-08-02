# Store submission pack — Bobi-Pursuit Capture

Everything the two submission forms ask for, ready to paste. Build the packages
first:

```bash
node extension/build.mjs
```

That writes `extension/dist/bobi-pursuit-capture-chrome-<v>.zip` and
`…-firefox-<v>.zip`.

---

## Common fields

| Field | Value |
|---|---|
| **Name** | Bobi-Pursuit — Capture |
| **Category** | Productivity |
| **Homepage** | https://pursuit.bobilabs.dev |
| **Support / issues** | https://github.com/Bobi-Labs/bobi-pursuit/issues |
| **Privacy policy URL** | https://github.com/Bobi-Labs/bobi-pursuit/blob/main/extension/PRIVACY.md |
| **Source** | https://github.com/Bobi-Labs/bobi-pursuit (MIT) |

**Summary (132 chars max, Chrome):**

> Capture the job you're viewing into your Bobi-Pursuit board, scored on the spot. One click. No account, no background crawling.

**Description:**

> Job boards are built for volume, not for you. A search that matches your stack
> returns four hundred results, of which maybe six are worth an hour.
>
> Bobi-Pursuit Capture takes the job you are looking at and puts it on your
> board in one click, scored against the kind of work you actually want, with
> the reasoning shown.
>
> • One click from any job page — no copy-paste, no retyping
> • Duplicates collapse, so the same role cross-posted to three boards is one card
> • Scored against tracks you define, not a generic relevance number
> • Works with the free Bobi-Pursuit app: no account, no sign-up, no API key
> • Your pipeline lives in your own browser. There is no server of ours
>
> It reads a page only when you click it. There is no background crawling and no
> tracking of any kind.
>
> Open source (MIT): https://github.com/Bobi-Labs/bobi-pursuit

---

## Chrome Web Store — permission justifications

Chrome requires a justification per permission. These are the answers.

| Permission | Justification to paste |
|---|---|
| `scripting` | Reads the job posting (title, description, budget) from the page the user is actively viewing, only when the user clicks capture. No script is injected at any other time. |
| `tabs` | Opens the user's own Bobi-Pursuit board in a tab to complete the capture, and detects the URL of the page being captured. |
| `storage` | Stores the user's settings only: which board to capture into. No user content is stored. |
| `sidePanel` | Displays the capture panel UI. |
| `<all_urls>` host permission | Job postings appear on a large and unpredictable set of sites, which cannot be enumerated in advance. The permission grants the ability to read a page the user explicitly captures from; it is exercised only on an explicit click, never in the background. |
| `cookies` *(optional)* | Optional and never requested by default. Requested only if the user enables self-hosted mode, where it reads a single session cookie on the user's own deployment to detect whether they are signed in. Not used with the free hosted app. |

**Single purpose statement:**

> Capture a job posting from the page the user is viewing into their own
> Bobi-Pursuit job pipeline.

**Data usage disclosures:** answer *no* to every collection category. The
extension transmits no data to the developer; captured content goes only to the
user's own board.

---

## Firefox AMO notes

- Upload `…-firefox-….zip`. It differs from the Chrome build **only** in the
  manifest: Firefox has no `side_panel` API, so it uses `sidebar_action`, and
  MV3 background is an event page (`background.scripts`) rather than a service
  worker.
- Add-on ID is `bobi-pursuit-capture@bobilabs.dev`, minimum Firefox 115.
- AMO reviews source for anything minified or generated. Nothing here is: every
  shipped file is hand-written and readable as-is, so the "source code
  submission" step does not apply. Say so in the notes-to-reviewer field.

**Notes to reviewer (paste):**

> No build step and no minification: every file in the package is the original
> source. The extension reads a page only in response to an explicit user click
> on the capture button. It contacts no server of ours — capture completes by
> opening the user's own board with the job details as URL parameters. The
> `cookies` permission is optional and is requested only if a user switches to
> self-hosted mode, where it reads one session cookie on their own domain.
> Full source: https://github.com/Bobi-Labs/bobi-pursuit

---

## Screenshots

`node scripts/capture-store-shots.mjs` writes 1280×800 PNGs to
`extension/dist/screenshots/`, which is the size both stores accept.

## Before you submit

- [ ] Chrome: one-time $5 developer registration, if this is the first listing.
- [ ] Both: the privacy policy URL above must resolve publicly. It only does
      once `extension/` is present in the public repo.
- [ ] Bump `version` in **both** manifests together — they must not drift.
