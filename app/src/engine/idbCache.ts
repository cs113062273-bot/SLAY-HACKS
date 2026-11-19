import type { Cache } from '../core/http';

/** IndexedDB-backed cache for API responses. Falls back to memory when storage is blocked. */
export class IdbCache implements Cache {
  private dbp: Promise<IDBDatabase | null> | null = null;
  private mem = new Map<string, unknown>();
  constructor(private name = 'veracite-cache') {}
  /**
   * Opened lazily: on a first visit the cross-origin-isolation service worker reloads the page right after load,
   * and an upgrade interrupted by that reload can leave later opens pending forever. A storage layer that does
   * not answer within 2 s (blocked, private mode, broken profile) is skipped and the cache stays in memory.
   */
  private get db(): Promise<IDBDatabase | null> {
    this.dbp ??= new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      const done = (db: IDBDatabase | null) => {
        clearTimeout(timer);
        resolve(db);
      };
      try {
        const req = indexedDB.open(this.name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => db.close();
          done(db);
        };
        req.onerror = () => done(null);
        req.onblocked = () => done(null);
      } catch {
        done(null);
      }
    });
    return this.dbp;
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
