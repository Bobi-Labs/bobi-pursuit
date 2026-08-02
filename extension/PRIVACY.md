# Privacy Policy — Bobi-Pursuit Capture

_Last updated: 2 August 2026_

## The short version

This extension does not collect, transmit, store or sell any personal data. It
has no analytics, no telemetry, no accounts, and no server belonging to us. It
sends nothing anywhere except to the address **you** configure.

## What it does

When you click the extension, it reads the job posting on the page you are
currently viewing (title, URL, description text, and any budget or company
detail it can find) and hands that to your Bobi-Pursuit board.

It only ever reads a page **when you click**. There is no background crawling,
no monitoring of your browsing, and no reading of pages you have not explicitly
captured.

## Where your data goes

By default, capture opens your board at `https://pursuit.bobilabs.dev` with the
job details in the URL and pre-fills the add form. That board is a static
application which stores everything in **your own browser's local storage**. The
data does not reach a server. We cannot see it, because there is nowhere for us
to see it from.

If you change the target to your own self-hosted deployment, your captures go to
**your** server, at an address you supply. We are not a party to that.

## Permissions, and why each exists

| Permission | Why |
|---|---|
| `activeTab` / `scripting` | To read the job posting off the page, at the moment you click. |
| `tabs` | To open your board in a tab to complete the capture. |
| `storage` | To remember your settings (which board to use). Settings only. |
| `sidePanel` / `sidebar_action` | To display the capture panel. |
| `<all_urls>` | Job postings live on a great many sites, and we cannot enumerate them in advance. This grants the **ability** to read a page you capture from; it is only exercised on your click. |
| `cookies` *(optional)* | **Not requested unless you turn on self-hosted mode.** Used only to detect whether you are signed in to your own deployment, by reading one session cookie on your own domain. Never used for the free app. If you decline it, the extension simply treats you as signed out. |

## Third parties

None. The extension contacts no third-party service, loads no remote code, and
includes no tracking of any kind.

## Changes

Any change to this policy will be published in this file in the public
repository, whose history is the record of what changed and when.

## Contact

Open an issue at <https://github.com/Bobi-Labs/bobi-pursuit> or email
matthew@bobilabs.dev.
