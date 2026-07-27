/**
 * The storage contract.
 *
 * Deliberately **whole-document, async, and dumb**: no queries, no patches, no
 * transactions, no partial reads. That is not laziness — it is the only contract
 * that maps 1:1 onto every backend we intend to ship:
 *
 * | adapter            | load                              | save                               |
 * |--------------------|-----------------------------------|------------------------------------|
 * | localStorage       | `getItem(key)`                    | `setItem(key, json)`               |
 * | File System Access | `(await handle.getFile()).text()` | `createWritable()` → write → close  |
 *
 * A pipeline is small (a few hundred jobs of plain text ≪ 1 MB), so rewriting
 * the whole document on every save is correct and deletes the entire
 * partial-write / merge-conflict bug class.
 *
 * Adapters are **dumb pipes**: they know nothing about `PursuitDoc`, schema
 * versions, migration, or debouncing. They move a string. That is all.
 */

/** Why a storage operation failed. Drives what the UI is allowed to say. */
export type StoreErrorKind =
  /** Out of space. Real: localStorage caps around 5 MB and job descriptions are prose. */
  | "quota"
  /** The backend is not usable here — Safari private mode, disabled storage, no permission. */
  | "unavailable"
  /** Anything else the backend threw. */
  | "io";

/**
 * The only error type an adapter may throw. The store catches it and parks its
 * message in `getStatus().error` — save failures are **never swallowed**. A tool
 * whose whole value proposition is "your data stays on your machine" cannot fail
 * to write and say nothing.
 */
export class StoreError extends Error {
  readonly kind: StoreErrorKind;

  constructor(
    kind: StoreErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "StoreError";
    this.kind = kind;
    if (options?.cause !== undefined) {
      // `cause` is ES2022; assigning it directly keeps us off that lib target.
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, StoreError.prototype);
  }
}

export interface StorageAdapter {
  /** Stable machine id — `"memory"`, `"local"`, `"fsa"`. */
  readonly id: string;
  /** Human label for the UI: `"This browser"`, `"pipeline.json"`. */
  readonly label: string;

  /**
   * Can this adapter be used *right now*? Implementations must **probe**, not
   * feature-detect: Safari in private mode exposes a complete `localStorage`
   * object whose `setItem` throws on first use.
   */
  isAvailable(): Promise<boolean>;

  /** The persisted document, or `null` if nothing has ever been written. */
  load(): Promise<string | null>;

  /** Replace the persisted document wholesale. Throws `StoreError`. */
  save(json: string): Promise<void>;

  /** Remove the persisted document entirely. */
  clear(): Promise<void>;

  /**
   * Optional: stash bytes we could not parse somewhere recoverable, and return a
   * human-readable location (or `null` if this backend cannot).
   *
   * This exists for exactly one moment — a load that fails to parse. The store
   * will not overwrite bytes it did not understand until they are safely copied
   * aside, because "your data never leaves your machine" and "we deleted your
   * data on startup" cannot both be true.
   */
  backup?(json: string): Promise<string | null>;
}
