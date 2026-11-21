/** Polite, resilient HTTP layer: per-host concurrency, retry with backoff+jitter, caching. */
import { sleep } from './text';

export interface Cache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export class MemoryCache implements Cache {
  private m = new Map<string, unknown>();
  async get(k: string) {
    return this.m.get(k);
  }
  async set(k: string, v: unknown) {
    this.m.set(k, v);
  }
}

export interface HttpOptions {
  cache?: Cache;
  /** max simultaneous requests per host */
  perHost?: Record<string, number>;
  /** extra query params per host, e.g. API keys */
  hostParams?: Record<string, Record<string, string>>;
  hostHeaders?: Record<string, Record<string, string>>;
  maxRetries?: number;
  timeoutMs?: number;
  onEvent?: (e: HttpEvent) => void;
}

export interface HttpEvent {
  host: string;
  url: string;
  status: number | 'error' | 'cache';
  attempt: number;
}

export class HttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

const DEFAULT_PER_HOST: Record<string, number> = {
  'api.crossref.org': 2,
  'api.openalex.org': 3,
  'api.semanticscholar.org': 1,
  'api.datacite.org': 3,
  'www.ebi.ac.uk': 3,
  'api.github.com': 2,
  'huggingface.co': 2,
  'eutils.ncbi.nlm.nih.gov': 2,
  'arxiv.org': 2,
};

export class Http {
  private active = new Map<string, number>();
  private queues = new Map<string, (() => void)[]>();
  /** hosts in cooldown after 429: host → resume timestamp */
  private cooldown = new Map<string, number>();
  /** hosts whose daily allowance is spent for this session */
  readonly disabled = new Set<string>();
  /** circuit breaker: consecutive requests that failed after all retries, and the time a tripped host is skipped until */
  private fails = new Map<string, number>();
  private trippedUntil = new Map<string, number>();
  private opts: HttpOptions;
  constructor(opts: HttpOptions = {}) {
    this.opts = opts;
  }

  private limit(host: string): number {
    return this.opts.perHost?.[host] ?? DEFAULT_PER_HOST[host] ?? 2;
  }

  private async acquire(host: string): Promise<void> {
    const n = this.active.get(host) ?? 0;
    if (n < this.limit(host)) {
      this.active.set(host, n + 1);
      return;
    }
    await new Promise<void>((res) => {
      const q = this.queues.get(host) ?? [];
      q.push(res);
      this.queues.set(host, q);
    });
    this.active.set(host, (this.active.get(host) ?? 0) + 1);
  }

  private release(host: string) {
    this.active.set(host, Math.max(0, (this.active.get(host) ?? 1) - 1));
    const q = this.queues.get(host);
    if (q && q.length) q.shift()!();
  }

  /** GET JSON (or text) with caching. Returns null on 404. Throws HttpError on persistent failure. */
  async get<T = any>(url: string, init: { as?: 'json' | 'text' | 'arraybuffer'; cacheKey?: string; noCache?: boolean; headers?: Record<string, string> } = {}): Promise<T | null> {
    const u = new URL(url);
    const host = u.host;
    const extra = this.opts.hostParams?.[host];
    if (extra) for (const [k, v] of Object.entries(extra)) if (v) u.searchParams.set(k, v);
    const key = init.cacheKey ?? url;
    const as = init.as ?? 'json';
    if (this.opts.cache && !init.noCache && as !== 'arraybuffer') {
      const hit = await this.opts.cache.get(key);
      if (hit !== undefined) {
        this.opts.onEvent?.({ host, url, status: 'cache', attempt: 0 });
        return hit as T | null;
      }
    }
    if (this.disabled.has(host)) throw new HttpError(429, url);
    // a host that keeps failing (outage, sustained throttling) is skipped for a while instead of making every
    // reference wait through a full retry cycle; callers report those lookups as unchecked, never as negative evidence
    if ((this.trippedUntil.get(host) ?? 0) > Date.now()) throw new HttpError(503, url);
    const maxRetries = this.opts.maxRetries ?? 6;
    let lastStatus = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const cd = this.cooldown.get(host);
      if (cd && cd > Date.now()) await sleep(Math.max(0, cd - Date.now()));
      await this.acquire(host);
      let res: Response | undefined;
      let body: unknown;
      let bodyOk = false;
      // the timeout covers the body too: a response whose body stalls after the headers would otherwise hang forever
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 25000);
      try {
        res = await fetch(u.toString(), { signal: ctl.signal, headers: { ...(this.opts.hostHeaders?.[host] ?? {}), ...(init.headers ?? {}) } });
        if (res.ok) {
          body = as === 'json' ? await res.json() : as === 'text' ? await res.text() : await res.arrayBuffer();
          bodyOk = true;
        }
      } catch {
        if (!res?.ok) res = undefined;
      } finally {
        clearTimeout(t);
        this.release(host);
      }
      if (res && res.ok && !bodyOk) res = undefined; // truncated or unparsable body: retry like a network error
      if (res && res.ok) {
        this.fails.set(host, 0);
        this.opts.onEvent?.({ host, url, status: res.status, attempt });
        if (this.opts.cache && !init.noCache && as !== 'arraybuffer') await this.opts.cache.set(key, body);
        return body as T;
      }
      lastStatus = res?.status ?? 0;
      this.opts.onEvent?.({ host, url, status: res ? res.status : 'error', attempt });
      if (res && (res.status === 404 || res.status === 410 || res.status === 400 || res.status === 422)) {
        this.fails.set(host, 0);
        if (this.opts.cache && !init.noCache && res.status !== 400) await this.opts.cache.set(key, null);
        return null;
      }
      // a spent daily allowance (OpenAlex reports it in USD) will not recover by retrying: disable the host
      if (res?.status === 429 && res.headers.get('x-ratelimit-remaining-usd') === '0' && res.headers.get('x-ratelimit-prepaid-remaining-usd') !== null) {
        const prepaid = Number(res.headers.get('x-ratelimit-prepaid-remaining-usd'));
        if (!prepaid) {
          this.disabled.add(host);
          throw new HttpError(429, url);
        }
      }
      // retryable: 429, 5xx, 202 (bot wall), network
      const ra = Number(res?.headers.get('retry-after'));
      const base = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 20) * 1000 : Math.min(16000, 600 * 2 ** attempt);
      const wait = base * (0.6 + Math.random() * 0.8);
      // 429s, and in browsers CORS-masked throttling responses (res undefined), slow the whole host down
      if (!res || res.status === 429 || res.status === 503) this.cooldown.set(host, Math.max(this.cooldown.get(host) ?? 0, Date.now() + wait));
      await sleep(wait);
    }
    const n = (this.fails.get(host) ?? 0) + 1;
    this.fails.set(host, n);
    if (n >= 3) {
      this.trippedUntil.set(host, Date.now() + 45000);
      this.fails.set(host, 2); // after the pause one probe decides: another failure trips it again
    }
    throw new HttpError(lastStatus, url);
  }
}
