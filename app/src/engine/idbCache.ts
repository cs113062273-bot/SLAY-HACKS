import type { Cache } from '../core/http';

/** IndexedDB-backed cache for API responses. Falls back to memory when storage is blocked. */
export class IdbCache implements Cache {
  private db: Promise<IDBDatabase | null>;
  private mem = new Map<string, unknown>();
  constructor(name = 'veracite-cache') {
    this.db = new Promise((resolve) => {
      try {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  /** Seed with pre-fetched responses (used for the bundled sample papers). */
  seed(entries: Record<string, unknown>) {
    for (const [k, v] of Object.entries(entries)) this.mem.set(k, v);
  }
  async get(key: string): Promise<unknown | undefined> {
    if (this.mem.has(key)) return this.mem.get(key);
    const db = await this.db;
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result === undefined ? undefined : r.result);
        r.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }
  async set(key: string, value: unknown): Promise<void> {
    this.mem.set(key, value);
    const db = await this.db;
    if (!db) return;
    try {
      db.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
    } catch {
      /* quota or private mode: memory only */
    }
  }
}
