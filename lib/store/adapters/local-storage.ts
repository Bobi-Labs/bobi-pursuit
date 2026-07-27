/**
 * localStorage adapter — the base layer, always.
 *
 * Even once a real file is attached through File System Access, localStorage
 * keeps holding the document. That makes a file an *additional sink* rather than
 * a *mode switch*: Firefox and Safari (no FSA) keep working unchanged, nothing
 * needs migrating when a user starts or stops syncing to disk, and revoking file
 * permission cannot cost anyone their pipeline.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. **`isAvailable()` probes an actual write.** Safari in private mode hands
 *    you a fully-formed `localStorage` object whose `setItem` throws on the
 *    first call. Feature-detecting `typeof localStorage` reports "available" and
 *    then every save fails.
 * 2. **`save()` calls `setItem` synchronously**, before returning its promise.
 *    The store force-flushes on `beforeunload`, where nothing async is
 *    guaranteed to run. Because there is no `await` before the write, the bytes
 *    land even if the returned promise is never settled.
 */

import { StoreError, type StorageAdapter } from "./types";

/** One document, one key. There is no workspace, no board picker, no index. */
export const PURSUIT_STORAGE_KEY = "pursuit.doc";

const PROBE_KEY = "pursuit.probe";

/** Firefox reports quota as `NS_ERROR_DOM_QUOTA_REACHED` / code 1014; everyone else as 22. */
function isQuotaError(e: unknown): boolean {
  if (typeof DOMException === "undefined" || !(e instanceof DOMException)) {
    return false;
  }
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

function getStorage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new StoreError(
      "unavailable",
      "This browser has no localStorage (or storage is disabled).",
    );
  }
  return window.localStorage;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly id = "local";
  readonly label = "This browser";

  readonly key: string;

  constructor(key: string = PURSUIT_STORAGE_KEY) {
    this.key = key;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const storage = getStorage();
      storage.setItem(PROBE_KEY, "1");
      storage.removeItem(PROBE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<string | null> {
    try {
      return getStorage().getItem(this.key);
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError(
        "io",
        "Could not read your pipeline from browser storage.",
        { cause: e },
      );
    }
  }

  async save(json: string): Promise<void> {
    // No `await` above this line, on purpose — see the file header.
    try {
      getStorage().setItem(this.key, json);
    } catch (e) {
      if (e instanceof StoreError) throw e;
      if (isQuotaError(e)) {
        throw new StoreError(
          "quota",
          "Browser storage is full — your latest changes were not saved. Export your pipeline to a file, then delete jobs you no longer need.",
          { cause: e },
        );
      }
      throw new StoreError(
        "io",
        "Could not save your pipeline to browser storage.",
        { cause: e },
      );
    }
  }

  async clear(): Promise<void> {
    try {
      getStorage().removeItem(this.key);
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError(
        "io",
        "Could not clear your pipeline from browser storage.",
        { cause: e },
      );
    }
  }

  /**
   * Copy unreadable bytes to a timestamped sibling key before anything
   * overwrites them. Returns the key, so the error the user reads can name the
   * exact place their data still is.
   */
  async backup(json: string): Promise<string | null> {
    const key = `${this.key}.corrupt-${Date.now()}`;
    try {
      getStorage().setItem(key, json);
      return key;
    } catch {
      // Almost certainly quota — the damaged document is large. The store treats
      // `null` as "do not overwrite", which is the only safe answer.
      return null;
    }
  }
}
