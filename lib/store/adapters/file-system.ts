/**
 * File System Access adapter — an optional real file on the user's disk.
 *
 * This is a **strict superset** of the browser story, never a mode switch:
 * localStorage stays the base layer and holds the document; a file is an
 * *additional* sink the store mirrors writes into (`store.attachFile()`).
 * Consequences that matter:
 *
 *   - Firefox and Safari have no File System Access API. They keep working, on
 *     localStorage alone, with the file UI simply absent.
 *     `isFileSystemAccessSupported()` is the one gate — it **degrades, it never
 *     throws**, and it is safe during prerender.
 *   - A user who revokes permission, moves the file, or deletes it does not lose
 *     their pipeline. The browser copy is still there.
 *
 * ⚠️ THE PERMISSION RULE, which shapes this entire API.
 *
 * A `FileSystemFileHandle` can survive a reload if you persist it (IndexedDB),
 * but its **permission cannot** — on the next load `queryPermission()` reports
 * `'prompt'`, and permission is only re-grantable from a **user gesture**. We
 * therefore do not persist handles at all: an attached file lasts for the
 * session, and the store falls back to localStorage alone after a reload until
 * the user attaches it again. That is a smaller lie than a "Saving to
 * pipeline.json" badge that silently stopped being true.
 *
 * So this adapter **never prompts** outside `ensureFilePermission()`, which the
 * UI must call from inside a click handler. Everything else checks, and throws a
 * typed `StoreError` if the answer is not `'granted'`.
 *
 * Error mapping (there is no `permission` kind — read `types.ts`: `unavailable`
 * is defined as "the backend is not usable here — … no permission"):
 *
 *   NotAllowedError / SecurityError  → `unavailable`  ("reconnect the file")
 *   NotFoundError                    → `unavailable`  (moved, renamed, deleted)
 *   QuotaExceededError               → `quota`        (disk full)
 *   anything else                    → `io`
 */

import { StoreError, type StorageAdapter } from "./types";

/** Pipelines are saved as `<name>.pursuit.json` — plain JSON, just self-identifying. */
export const PURSUIT_FILE_EXTENSION = ".pursuit.json";

export type FilePermission = "granted" | "prompt" | "denied";

/* ────────────────────────── The bits TS's lib.dom lacks ──────────────────────────
 * `FileSystemFileHandle` and `createWritable()` are in lib.dom. The permission
 * methods and the pickers are not (they are the non-standardised half of the
 * spec), so we describe exactly the slice we use and cast at the boundary. No
 * global augmentation: if a future TypeScript ships these, nothing collides.
 */

interface FsPermissionDescriptor {
  mode: "read" | "readwrite";
}

interface PermissionAwareHandle {
  queryPermission?(descriptor: FsPermissionDescriptor): Promise<FilePermission>;
  requestPermission?(
    descriptor: FsPermissionDescriptor,
  ): Promise<FilePermission>;
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
}

interface FilePickerWindow {
  showSaveFilePicker?(
    options?: SaveFilePickerOptions,
  ): Promise<FileSystemFileHandle>;
  showOpenFilePicker?(
    options?: OpenFilePickerOptions,
  ): Promise<FileSystemFileHandle[]>;
}

function pickerWindow(): FilePickerWindow | null {
  if (typeof window === "undefined") return null;
  return window as unknown as FilePickerWindow;
}

/**
 * Is the File System Access API usable in this browser?
 *
 * Chrome/Edge: yes. Firefox/Safari: no — and that is a supported configuration,
 * not an error. Every entry point below returns `null` / `false` rather than
 * throwing when this is `false`, so the caller's only job is to not render the
 * button.
 *
 * Safe during prerender: `typeof window` is guarded, so this is `false` at build
 * time and the first client render agrees with the prerendered HTML.
 */
export function isFileSystemAccessSupported(): boolean {
  const w = pickerWindow();
  return w !== null && typeof w.showSaveFilePicker === "function";
}

/* ────────────────────────────── Error mapping ────────────────────────────── */

function errorName(e: unknown): string {
  if (e && typeof e === "object" && "name" in e) {
    const name = (e as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/** The user hit Cancel in the file picker. Not a failure — nothing to report. */
function isAbort(e: unknown): boolean {
  return errorName(e) === "AbortError";
}

const JSON_FILE_TYPE: FilePickerAcceptType = {
  description: "Bobi Pursuit pipeline",
  accept: { "application/json": [".json"] },
};

function toFileStoreError(
  e: unknown,
  fileName: string,
  verb: string,
): StoreError {
  if (e instanceof StoreError) return e;

  switch (errorName(e)) {
    case "NotAllowedError":
    case "SecurityError":
      return new StoreError(
        "unavailable",
        `Permission to use “${fileName}” was withdrawn, so it could not be ${verb}. Your pipeline is still saved in this browser — attach the file again to resume syncing it.`,
        { cause: e },
      );

    case "NotFoundError":
      return new StoreError(
        "unavailable",
        `“${fileName}” is no longer where it was — it may have been moved, renamed, or deleted. Your pipeline is still saved in this browser.`,
        { cause: e },
      );

    case "QuotaExceededError":
      return new StoreError(
        "quota",
        `There is not enough room on disk to save “${fileName}”.`,
        { cause: e },
      );

    default:
      return new StoreError("io", `Could not ${verb} “${fileName}”.`, {
        cause: e,
      });
  }
}

/* ───────────────────────────── Permissions ───────────────────────────── */

/**
 * The handle's current permission — **read-only, never prompts**. Safe to call
 * on mount, in an effect, anywhere.
 *
 * An implementation without `queryPermission` (it is not in every engine that
 * ships `createWritable`) is treated as granted: we then find out for real on
 * the first read/write, and that failure maps to `unavailable` like any other.
 */
export async function queryFilePermission(
  handle: FileSystemFileHandle,
): Promise<FilePermission> {
  const permissioned = handle as unknown as PermissionAwareHandle;
  if (typeof permissioned.queryPermission !== "function") return "granted";
  try {
    return await permissioned.queryPermission({ mode: "readwrite" });
  } catch {
    // A handle whose backing file is gone can throw here. `prompt` is the honest
    // answer: the UI offers to reconnect, and reconnecting reports the real cause.
    return "prompt";
  }
}

/**
 * Ensure we can write to `handle`, prompting the user if we must.
 *
 * ⚠️ **CALL THIS FROM A USER GESTURE — a click handler, nothing else.** Chrome
 * rejects `requestPermission()` outside one. Returns `'prompt'` (not `'denied'`)
 * if the request itself was refused for lack of a gesture — that state is still
 * recoverable by clicking the button properly.
 */
export async function ensureFilePermission(
  handle: FileSystemFileHandle,
): Promise<FilePermission> {
  const current = await queryFilePermission(handle);
  if (current !== "prompt") return current;

  const permissioned = handle as unknown as PermissionAwareHandle;
  if (typeof permissioned.requestPermission !== "function") return "prompt";

  try {
    return await permissioned.requestPermission({ mode: "readwrite" });
  } catch {
    return "prompt";
  }
}

/* ─────────────────────────────── Pickers ─────────────────────────────── */

/** `My Search` → `my-search.pursuit.json`. Path separators cannot survive this. */
export function suggestFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "pipeline"}${PURSUIT_FILE_EXTENSION}`;
}

/**
 * "Save my pipeline to a file…" — `showSaveFilePicker`.
 *
 * Returns `null` when the user cancels **and** when the browser has no File
 * System Access API. Both are ordinary outcomes; neither throws. Must be called
 * from a user gesture (the picker itself requires one).
 */
export async function pickPursuitFile(
  suggestedName: string,
): Promise<FileSystemFileHandle | null> {
  const w = pickerWindow();
  if (!w?.showSaveFilePicker) return null;

  try {
    return await w.showSaveFilePicker({
      suggestedName: suggestedName.endsWith(PURSUIT_FILE_EXTENSION)
        ? suggestedName
        : suggestFileName(suggestedName),
      types: [JSON_FILE_TYPE],
    });
  } catch (e) {
    if (isAbort(e)) return null;
    throw toFileStoreError(e, suggestedName, "created");
  }
}

/**
 * "Open a pipeline file…" — `showOpenFilePicker`. `null` on cancel or on an
 * unsupported browser. Must be called from a user gesture.
 */
export async function openPursuitFile(): Promise<FileSystemFileHandle | null> {
  const w = pickerWindow();
  if (!w?.showOpenFilePicker) return null;

  try {
    const handles = await w.showOpenFilePicker({
      types: [JSON_FILE_TYPE],
      multiple: false,
    });
    return handles[0] ?? null;
  } catch (e) {
    if (isAbort(e)) return null;
    throw toFileStoreError(e, "that file", "opened");
  }
}

/* ─────────────────────────────── Adapter ─────────────────────────────── */

class FileSystemAdapter implements StorageAdapter {
  readonly id = "fsa";
  /** The file name — the UI renders "Saving to pipeline.pursuit.json". */
  readonly label: string;

  private readonly handle: FileSystemFileHandle;

  constructor(handle: FileSystemFileHandle) {
    this.handle = handle;
    this.label = handle.name;
  }

  /** The handle we were built from, for a UI that wants to re-check permission. */
  get fileHandle(): FileSystemFileHandle {
    return this.handle;
  }

  /**
   * Usable *right now* — which for a file means the API exists **and**
   * permission is currently granted. After a reload it is `false`, and that is
   * the correct answer, not a bug.
   */
  async isAvailable(): Promise<boolean> {
    if (!isFileSystemAccessSupported()) return false;
    return (await queryFilePermission(this.handle)) === "granted";
  }

  /**
   * Fail fast on a handle we are not allowed to touch. Without this, a save on a
   * `'prompt'` handle either rejects deep inside `createWritable()` with an
   * opaque DOMException or — depending on the engine — sits there.
   */
  private async assertPermitted(): Promise<void> {
    const state = await queryFilePermission(this.handle);
    if (state === "granted") return;

    throw new StoreError(
      "unavailable",
      state === "denied"
        ? `Permission to use “${this.label}” was denied. Your pipeline is still saved in this browser.`
        : `“${this.label}” needs your permission again — browsers forget file access on reload. Attach it again to resume saving to it. Nothing is lost: your pipeline is still saved in this browser.`,
    );
  }

  async load(): Promise<string | null> {
    await this.assertPermitted();
    try {
      const text = await (await this.handle.getFile()).text();
      // A file the user just created through the save picker exists and is
      // empty. That is "nothing has ever been written here", not corruption.
      return text.trim() === "" ? null : text;
    } catch (e) {
      throw toFileStoreError(e, this.label, "read");
    }
  }

  async save(json: string): Promise<void> {
    await this.assertPermitted();

    let writable: FileSystemWritableFileStream;
    try {
      writable = await this.handle.createWritable();
    } catch (e) {
      throw toFileStoreError(e, this.label, "saved");
    }

    try {
      await writable.write(json);
      await writable.close();
    } catch (e) {
      // `createWritable()` writes to a swap file and only commits on `close()`,
      // so aborting leaves the user's file untouched — the old contents survive
      // a failed write. Never leave the stream dangling.
      try {
        await writable.abort();
      } catch {
        /* already closed / already gone */
      }
      throw toFileStoreError(e, this.label, "saved");
    }
  }

  /**
   * DELIBERATE DIVERGENCE FROM THE CONTRACT. `StorageAdapter.clear()` says
   * "remove the persisted document entirely" — for localStorage, one
   * `removeItem`. Here it would mean truncating a file **the user chose, on
   * their disk, that may well sit in a git repo or a Dropbox folder**. Clearing
   * your data inside the app is not consent to destroy that file.
   *
   * So this is a no-op, and the store still clears the browser copy. The
   * pipeline leaves the app; the file remains theirs.
   */
  async clear(): Promise<void> {
    /* intentionally does not touch the user's file — see above */
  }
}

/** The file sink for the pipeline. Mirror it alongside localStorage, never instead of it. */
export function createFileSystemAdapter(
  handle: FileSystemFileHandle,
): StorageAdapter {
  return new FileSystemAdapter(handle);
}
