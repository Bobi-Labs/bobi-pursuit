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

## Chrome Web Store — Privacy practices tab

Chrome blocks publishing until EVERY row below is filled in. It asks for a
justification per permission, including ones you might not think of as
permissions, and it will not tell you which are missing until you hit publish.

**Single purpose** (required, its own field):

> Capture a job posting from the page the user is viewing into their own
> Bobi-Pursuit job pipeline.

**Per-permission justifications:**

| Permission | Justification to paste |
|---|---|
| `scripting` | Reads the job posting (title, description, budget) from the page the user is actively viewing, only at the moment they click capture. No script is injected at any other time. |
| `tabs` | Opens the user own Bobi-Pursuit board in a tab to complete the capture, and reads the URL of the page being captured so the saved job links back to its source. |
| `storage` | Stores the user settings only: which board to capture into and which mode to use. No captured content and no personal data is stored by the extension. |
| `sidePanel` | Displays the capture panel UI, which is the extension entire interface. |
| `cookies` | **Optional permission, never requested by default.** Requested only if the user switches on self-hosted mode, where it reads a single session cookie on the user own deployment to detect whether they are signed in. It is not used with the hosted app, and declining it degrades to "not signed in" rather than breaking capture. |
| `<all_urls>` host permission | Job postings appear on a large and unpredictable set of sites which cannot be enumerated in advance. This grants the ability to read a page the user explicitly captures from; it is exercised only on an explicit click and never in the background. |

**Remote code** (required, and the answer is no):

> No, I am not using remote code.

Every line the extension runs is in the package. It loads no external script,
uses no CDN, evaluates no fetched string, and has no hosted config. Nothing here
is minified, bundled or generated either, so what is reviewed is what runs.

**Data usage** (required, plus a certification checkbox):

Answer **no to every collection category**. The extension transmits nothing to
the developer. A capture is handed to the user own board via a URL, and on the
free tier that board stores everything in the user own browser. Then tick the
certification that the disclosures are complete and accurate.

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

## Images

`node scripts/capture-store-shots.mjs` writes a set per store, because the two
demand different sizes and neither is flexible:

| | Size | Path |
|---|---|---|
| Chrome screenshots | **1280x800 exactly** (or 640x400) | `extension/dist/screenshots/chrome/` |
| AMO screenshots | up to 2400x1800; shot at 2400x1500 | `extension/dist/screenshots/amo/` |
| Store icon (both) | 128x128 | `extension/icons/icon128.png` |
| Chrome small promo tile | 440x280 | `extension/dist/promo/` |
| Chrome marquee promo tile | 1400x560 | `extension/dist/promo/` |

Promo tiles are optional and come from `node scripts/capture-promo-tiles.mjs`.
They are composed rather than captured: a screenshot shrunk to 440x280 is
unreadable, and that tile sits beside search results.

All images must be 24-bit PNG with no alpha. Puppeteer emits colour type 2, so
this is already satisfied; worth re-checking if the capture ever changes.

## Before you submit

- [ ] Chrome: one-time $5 developer registration, if this is the first listing.
- [ ] Both: the privacy policy URL above must resolve publicly. It only does
      once `extension/` is present in the public repo.
- [ ] Bump `version` in **both** manifests together — they must not drift.
