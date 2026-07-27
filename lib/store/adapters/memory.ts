/**
 * In-memory adapter — prerender, tests, and the "storage is blocked" fallback.
 *
 * During prerender (`output: 'export'` still prerenders at build time) there is
 * no `window`, so the store starts with no adapter at all and holds a frozen
 * empty document. This adapter covers the other two cases: a test that wants to
 * assert on write behaviour, and a real browser where `localStorage` throws
 * (Safari private mode, storage disabled by policy). In that last case the app
 * keeps working for the session and the store says so in `status.error` — a
 * degraded tool that tells you it is degraded beats a blank screen.
 */

import type { StorageAdapter } from "./types";

export interface MemoryAdapterOptions {
  /** Pre-seed the adapter, as if a previous session had written this. */
  initial?: string | null;
  id?: string;
  label?: string;
}

export class MemoryAdapter implements StorageAdapter {
  readonly id: string;
  readonly label: string;

  private value: string | null;

  /** Every `save()` ever made, in order. Tests assert on debounce/flush behaviour. */
  readonly writes: string[] = [];

  constructor(options: MemoryAdapterOptions = {}) {
    this.id = options.id ?? "memory";
    this.label = options.label ?? "This session only";
    this.value = options.initial ?? null;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async load(): Promise<string | null> {
    return this.value;
  }

  async save(json: string): Promise<void> {
    this.value = json;
    this.writes.push(json);
  }

  async clear(): Promise<void> {
    this.value = null;
  }

  /** Test-only synchronous peek. Not part of `StorageAdapter`. */
  peek(): string | null {
    return this.value;
  }
}
