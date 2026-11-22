import { useSyncExternalStore } from 'react';
import type { Doc } from '../core/doc';
import { Http, MemoryCache, type Cache, type HttpEvent } from '../core/http';
import type { RefResult, SourceName } from '../core/types';
import { verifyReference } from '../core/verify';
import { IdbCache } from './idbCache';
import { docFromBibtex, docFromDocx, docFromPdf, docFromText, fetchArxivPdf, parseArxivInput } from './inputs';

/** Calibrated triage (precision on Citation-Integrity dev: supported .83, review .76); see ml/calib.py */
export type SupportLabel = 'supported' | 'review' | 'unclear' | 'mention';

export interface Evidence {
  text: string;
  score: number;
  section?: 'abstract' | 'full text';
}

export interface ClaimCheck {
  citanceId: number;
  refIndex: number;
  status: 'queued' | 'running' | 'done' | 'no_source' | 'skipped';
  label?: SupportLabel;
  probs?: Record<string, number>;
  evidence: Evidence[];
  sourceKind?: 'abstract' | 'full text';
  note?: string;
  /** within 'review': the cited text looks unrelated to the claim (NEI dominates) */
  unrelated?: boolean;
}

/** quick = references only (no model download); full = references, then claim support */
export type Mode = 'quick' | 'full';
export function savedMode(): Mode {
  try {
    return localStorage.getItem('veracite-mode') === 'quick' ? 'quick' : 'full';
  } catch {
    return 'full';
  }
}
export function saveMode(m: Mode) {
  try {
    localStorage.setItem('veracite-mode', m);
  } catch {
    /* per-viewer convenience only */
  }
}

export interface State {
  mode: Mode;
  phase: 'idle' | 'reading' | 'checking' | 'done' | 'error';
  inputName?: string;
  readProgress: number;
  doc: Doc | null;
  results: (RefResult | null)[];
  claims: ClaimCheck[];
  claimPhase: 'idle' | 'loading-model' | 'running' | 'done' | 'unavailable';
  modelProgress: number;
  error?: string;
  sourceStatus: Partial<Record<SourceName, { ok: number; limited: number; failed: number }>>;
  startedAt?: number;
  finishedAt?: number;
  /** set for bundled samples: index responses replayed from a snapshot (checks and inference still run live) */
  replayed?: string;
}

const initial: State = {
  mode: 'full', phase: 'idle', readProgress: 0, doc: null, results: [], claims: [], claimPhase: 'idle', modelProgress: 0, sourceStatus: {},
  inputName: undefined, error: undefined, startedAt: undefined, finishedAt: undefined, replayed: undefined,
};

let state: State = initial;
const listeners = new Set<() => void>();
function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
export function useSession<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
  );
}
export const getState = () => state;
// read-only handle for diagnostics (scripts/e2e.ts)
(globalThis as Record<string, unknown>).__veracite = getState;

const HOST_SOURCE: Record<string, SourceName> = {
  'api.crossref.org': 'crossref',
  'api.openalex.org': 'openalex',
  'api.semanticscholar.org': 'semanticscholar',
  'api.datacite.org': 'datacite',
  'www.ebi.ac.uk': 'europepmc',
  'inspirehep.net': 'inspire',
  'api.github.com': 'github',
  'huggingface.co': 'huggingface',
};

export const cache = new IdbCache();
// Recorded sample responses belong to that audit only. Live inputs use the persistent live-response cache.
let activeCache: Cache = cache;
/** date the bundled sample snapshots were recorded (scripts/build-seeds.ts) */
export const SNAPSHOT_DATE = '2026-11-22';
let pendingEvents: HttpEvent[] = [];
let flushTimer: number | undefined;
function onHttp(e: HttpEvent) {
  pendingEvents.push(e);
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    const evs = pendingEvents;
    pendingEvents = [];
    set((s) => {
      const st = { ...s.sourceStatus };
      for (const ev of evs) {
        const src = HOST_SOURCE[ev.host];
        if (!src) continue;
        const cur = { ...(st[src] ?? { ok: 0, limited: 0, failed: 0 }) };
        if (ev.status === 'cache' || (typeof ev.status === 'number' && ev.status < 300) || ev.status === 404) cur.ok++;
        else if (ev.status === 429 || ev.status === 503) cur.limited++;
        else cur.failed++;
        st[src] = cur;
      }
      return { sourceStatus: st };
    });
  }, 250);
}

function readKeys(): Record<string, Record<string, string>> {
  try {
    const k = JSON.parse(localStorage.getItem('veracite-keys') ?? '{}');
    const hp: Record<string, Record<string, string>> = {};
    if (k.openalex) hp['api.openalex.org'] = { api_key: k.openalex };
    return hp;
  } catch {
    return {};
  }
}
function readHeaders(): Record<string, Record<string, string>> {
  try {
    const k = JSON.parse(localStorage.getItem('veracite-keys') ?? '{}');
    return k.s2 ? { 'api.semanticscholar.org': { 'x-api-key': k.s2 } } : {};
  } catch {
    return {};
  }
}

let runId = 0;

export type Input = { kind: 'file'; file: File } | { kind: 'text'; text: string; name?: string } | { kind: 'arxiv'; id: string } | { kind: 'sample'; url: string; name: string; seed?: string };

/** what a quick check needs to start claim support later without re-reading the document */
let claimCtx: { my: number; http: Http; mod: Promise<typeof import('./claims') | null> } | null = null;

export async function analyze(input: Input, mode: Mode = savedMode()) {
  const my = ++runId;
  claimCtx = null;
  set({ ...initial, mode, phase: 'reading', inputName: input.kind === 'file' ? input.file.name : input.kind === 'arxiv' ? `arXiv:${input.id}` : input.kind === 'sample' ? input.name : (input.name ?? 'Pasted text'), startedAt: Date.now() });
  try {
    let doc: Doc;
    const runCache = input.kind === 'sample' ? new MemoryCache() : cache;
    activeCache = runCache;
    const onProgress = (p: number) => my === runId && set({ readProgress: p });
    if (input.kind === 'file') {
      const name = input.file.name.toLowerCase();
      const buf = await input.file.arrayBuffer();
      if (name.endsWith('.pdf') || input.file.type === 'application/pdf') doc = await docFromPdf(buf, onProgress);
      else if (name.endsWith('.docx')) doc = await docFromDocx(buf);
      else if (name.endsWith('.bib')) doc = docFromBibtex(new TextDecoder().decode(buf));
      else doc = docFromText(new TextDecoder().decode(buf));
    } else if (input.kind === 'arxiv') {
      doc = await docFromPdf(await fetchArxivPdf(input.id), onProgress);
    } else if (input.kind === 'sample') {
      if (input.seed) {
        try {
          const r = await fetch(input.seed);
          if (r.ok) {
            const entries = await r.json();
            await Promise.all(Object.entries(entries).map(([key, value]) => runCache.set(key, value)));
            if (my === runId) set({ replayed: SNAPSHOT_DATE });
          }
        } catch {
          /* seed is an optimization only */
        }
      }
      const r = await fetch(input.url);
      if (!r.ok) throw new Error(`Could not download the sample (${r.status}).`);
      doc = /\.pdf$|\/pdf\//.test(input.url) ? await docFromPdf(await r.arrayBuffer(), onProgress) : docFromText(await r.text());
    } else {
      const ax = parseArxivInput(input.text);
      doc = ax ? await docFromPdf(await fetchArxivPdf(ax), onProgress) : docFromText(input.text);
    }
    if (my !== runId) return;
    if (!doc.references.length) {
      set({ phase: 'error', error: 'No reference list found. Upload a paper with a References section, a .bib file, or paste the reference list.' });
      return;
    }
    set({ doc, phase: 'checking', results: doc.references.map(() => null) });
    // fetch the claim-check code now, so a connection lost during reference checks cannot break the report later
    const claimsMod = import('./claims').catch(() => null);
    // full audit: download the models in the background while references are checked (off the critical path)
    if (mode === 'full' && doc.citances.length) {
      import('./mlClient').then((ml) => ml.loadModels((l, t) => my === runId && set({ modelProgress: t ? l / t : 0 })).catch(() => undefined));
    }
    const http = new Http({ cache: runCache, onEvent: onHttp, maxRetries: 5, hostParams: readKeys(), hostHeaders: readHeaders() });
    claimCtx = { my, http, mod: claimsMod };
    let next = 0;
    const worker = async () => {
      while (next < doc.references.length && my === runId) {
        const i = next++;
        let r: RefResult;
        try {
          r = await verifyReference(doc.references[i], { http, budgetMs: 40000 }, i);
        } catch (e) {
          r = { index: i, parsed: doc.references[i], verdict: 'unchecked', confidence: 0.5, checks: [], issues: [`Check failed: ${(e as Error).message}`], candidates: [], sourcesQueried: [], sourcesFailed: [] };
        }
        if (my !== runId) return;
        set((s) => {
          const results = s.results.slice();
          results[i] = r;
          return { results };
        });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (my !== runId) return;
    // A second, sequential pass for references whose indexes were rate-limited during the parallel pass: by now the
    // limits have usually cooled down. Only a definite answer replaces "unchecked".
    const pending = getState().results.map((r, i) => (r?.verdict === 'unchecked' ? i : -1)).filter((i) => i >= 0);
    if (pending.length && pending.length <= 30) {
      await new Promise((res) => setTimeout(res, 3000));
      for (const i of pending) {
        if (my !== runId) return;
        const r = await verifyReference(doc.references[i], { http, budgetMs: 30000 }, i).catch(() => null);
        if (r && r.verdict !== 'unchecked' && my === runId)
          set((s) => {
            const results = s.results.slice();
            results[i] = r;
            return { results };
          });
      }
    }
    if (my !== runId) return;
    set({ phase: 'done', finishedAt: Date.now() });
    if (mode === 'full') await runClaimAudit();
  } catch (e) {
    if (my === runId) set({ phase: 'error', error: (e as Error).message });
  }
}

/** Claim-support stage: runs after a full audit, or on request after a quick check. */
export async function runClaimAudit() {
  const ctx = claimCtx;
  const s = getState();
  if (!ctx || ctx.my !== runId || !s.doc || s.phase !== 'done' || s.claimPhase !== 'idle') return;
  set({ mode: 'full', claimPhase: 'loading-model' }); // also guards against a second click
  const mod = await ctx.mod;
  if (ctx.my !== runId) return;
  if (!mod) {
    set({ claimPhase: 'unavailable' });
    return;
  }
  await mod.runClaimChecks(ctx.my, () => runId, getState, set, ctx.http);
}

/** Re-run references that could not be checked (index outage or rate limit). */
export async function retryUnchecked() {
  const s = getState();
  if (!s.doc || s.phase !== 'done') return;
  const idx = s.results.map((r, i) => (r?.verdict === 'unchecked' ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return;
  const my = runId;
  set({ phase: 'checking' });
  const http = new Http({ cache: activeCache, onEvent: onHttp, maxRetries: 5, hostParams: readKeys(), hostHeaders: readHeaders() });
  for (const i of idx) {
    if (my !== runId) return;
    const r = await verifyReference(s.doc.references[i], { http, budgetMs: 40000 }, i).catch(() => null);
    if (r && my === runId)
      set((st) => {
        const results = st.results.slice();
        results[i] = r;
        return { results };
      });
  }
  if (my === runId) set({ phase: 'done' });
}

export function reset() {
  runId++;
  claimCtx = null;
  activeCache = cache;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  set(initial);
}

export type Setter = typeof set;
export type Getter = typeof getState;
