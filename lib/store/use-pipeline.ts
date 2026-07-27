"use client";

/**
 * React bindings — `useSyncExternalStore` over the in-memory document.
 *
 * ⚠️ The single rule that makes a static export work:
 *
 *   **`getServerSnapshot()` must never touch `window` or `localStorage`.**
 *
 * `output: 'export'` does not mean "no server rendering" — it means the server
 * rendering happens on your machine, at build time. Every component below is
 * prerendered into `out/index.html` by Node, where `localStorage` does not
 * exist. Reading it during render is either a build-time crash or, worse, a
 * hydration mismatch that React papers over by silently re-rendering the wrong
 * tree.
 *
 * So the server snapshot is a frozen, deterministic, empty document; the first
 * client render matches it exactly; and the real data arrives from `init()`
 * inside an effect, one frame after hydration completes.
 *
 * ```tsx
 * useEffect(() => { void store.init(); }, []);
 * const doc = usePipeline();
 * const { loaded, error } = useStoreStatus();
 * ```
 *
 * Gate empty states on `loaded`, not on `doc.jobs.length` — for one frame after
 * hydration those are the same thing, and "You have no jobs yet" flashing in
 * front of someone who has two hundred is how a local-first tool loses trust.
 */

import { useSyncExternalStore } from "react";

import type { PursuitDoc } from "@/lib/types";
import { store, type StoreStatus } from "./store";

/** The live document. Re-renders on every effective mutation, and only then. */
export function usePipeline(): PursuitDoc {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}

/**
 * Save state — where it is stored, whether a write is in flight, and the last
 * failure. **Render the error.** A tool whose pitch is "your data never leaves
 * your machine" that fails to write and says nothing is worse than one that
 * never claimed it.
 *
 * `getStatus` doubles as the server snapshot: it reads no browser API, and the
 * store freezes each status object so its reference changes only when the status
 * genuinely does — which is precisely what `useSyncExternalStore` compares.
 */
export function useStoreStatus(): StoreStatus {
  return useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus);
}
