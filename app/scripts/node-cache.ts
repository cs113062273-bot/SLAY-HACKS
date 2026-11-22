import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Cache } from '../src/core/http';

/** JSON-file cache so benchmark runs are reproducible and do not re-hit public APIs. */
export class FileCache implements Cache {
  private m: Record<string, unknown> = {};
  private dirty = false;
  private path: string;
  /** read-only layers consulted after this cache (recorded responses), never written */
  private layers: Record<string, unknown>[];
  constructor(path: string, layers: string[] = []) {
    this.path = path;
    if (existsSync(path)) this.m = JSON.parse(readFileSync(path, 'utf8'));
    this.layers = layers.filter((p) => existsSync(p)).map((p) => JSON.parse(readFileSync(p, 'utf8')));
    setInterval(() => this.flush(), 5000).unref();
  }
  async get(k: string) {
    if (k in this.m) return this.m[k];
    for (const l of this.layers) if (k in l) return l[k];
    return undefined;
  }
  async set(k: string, v: unknown) {
    this.m[k] = v;
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.m));
    this.dirty = false;
  }
}

/**
 * Offline replay for regression runs: layered read-only caches, no network. A lookup that no recorded
 * response answers counts as a miss for the reference being verified (tracked with AsyncLocalStorage),
 * so a score change can be split into "new code asked a question nobody recorded" vs a real verdict change.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
export const replayRef = new AsyncLocalStorage<number>();
export const replayMisses = new Map<number, string[]>();
export class ReplayCache implements Cache {
  private layers: Record<string, unknown>[];
  constructor(paths: string[]) {
    this.layers = paths.filter((p) => existsSync(p)).map((p) => JSON.parse(readFileSync(p, 'utf8')));
    // an unrecorded lookup answers 500 (a failed source, never negative evidence) without the host-wide cooldown a network error triggers
    globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
  }
  async get(k: string) {
    for (const l of this.layers) if (k in l) return l[k];
    const i = replayRef.getStore();
    if (i !== undefined) replayMisses.set(i, [...(replayMisses.get(i) ?? []), k]);
    return undefined;
  }
  async set() {}
  flush() {}
}
export function makeCache(defaultPath: string): FileCache | ReplayCache {
  const r = process.env.VERACITE_REPLAY;
  if (r) return new ReplayCache(r.split(';'));
  // VERACITE_READ_LAYERS="a.json;b.json": live run that reuses recorded responses and writes only new ones
  return new FileCache(process.env.VERACITE_CACHE_PATH ?? defaultPath, process.env.VERACITE_READ_LAYERS?.split(';') ?? []);
}
