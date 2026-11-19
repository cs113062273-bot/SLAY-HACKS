/**
 * Claim-support stage: for every citing sentence, find the most relevant sentences in the cited work
 * (abstract, or full text when it is open access) and classify support with the in-browser verifier.
 */
import { bm25, rrf } from '../core/bm25';
import { splitSentences } from '../core/doc';
import type { Http } from '../core/http';
import { europePmcByDoi, europePmcFullText, openalexDoi, s2Paper } from '../core/sources';
import type { RefResult } from '../core/types';
import { cache, type ClaimCheck, type Getter, type Setter, type SupportLabel } from './session';
import { CLAIM_CONFIG } from './claimConfig';

interface Source {
  kind: 'abstract' | 'full text';
  sentences: string[];
  vecs?: Map<number, number[]>;
}

const MAX_TASKS = 400;

async function getSource(r: RefResult, http: Http): Promise<Source | null> {
  const m = r.match;
  if (!m) return null;
  const arx = m.arxivId ?? r.parsed.arxivIds[0];
  // 1. open-access full text from arXiv (CORS-enabled)
  if (arx) {
    // extracted sentences are cached, so a repeat audit neither re-downloads nor re-parses the PDF
    const key = `fulltext:arxiv:${arx}`;
    try {
      const hit = (await cache.get(key)) as string[] | undefined;
      if (hit?.length) return { kind: 'full text', sentences: hit };
      const res = await fetch(`https://arxiv.org/pdf/${arx}`);
      if (res.ok) {
        const { docFromPdf } = await import('./inputs');
        const d = await docFromPdf(await res.arrayBuffer());
        const sents = d.sentences.filter((s) => s.length > 30 && s.length < 600);
        if (sents.length > 20) {
          await cache.set(key, sents).catch(() => undefined);
          return { kind: 'full text', sentences: sents };
        }
      }
    } catch (e) {
      console.warn(`Full text unavailable for arXiv:${arx}:`, e);
    }
  }
  // 2. open-access full text from Europe PMC (biomedical and life sciences)
  let abs = m.abstract;
  if (m.doi) {
    const epmc = await europePmcByDoi(http, m.doi).catch(() => null);
    if (epmc?.pmcid && epmc.isOA) {
      const paras = await europePmcFullText(http, epmc.pmcid).catch(() => null);
      const sents = (paras ?? []).flatMap((p) => splitSentences(p)).filter((s) => s.length > 30 && s.length < 600);
      if (sents.length > 20) return { kind: 'full text', sentences: sents };
    }
    if (!abs && epmc?.abstract) abs = epmc.abstract;
  }
  // 3. abstract from the matched record or from another index
  if (!abs && m.doi) abs = (await openalexDoi(http, m.doi).catch(() => null))?.abstract;
  if (!abs) {
    const id = arx ? `arXiv:${arx}` : m.doi ? `DOI:${m.doi}` : null;
    if (id) abs = (await s2Paper(http, id).catch(() => null))?.abstract;
  }
  if (!abs) return null;
  const sents = splitSentences(abs.replace(/^abstract[:.\s]*/i, '').replace(/\s+/g, ' '));
  // the title alone is not evidence; require real abstract sentences
  return sents.length >= 2 ? { kind: 'abstract', sentences: sents } : null;
}

/** Prose sentences only: equations, table rows and figure text extracted from PDFs are not claims. */
export function isProse(s: string): boolean {
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  const nonSpace = s.replace(/\s/g, '').length || 1;
  const math = (s.match(/[=|∑∏∫√≤≥≈∈∀∃⊂⊆⊠θλμσπ^_{}]/gu) ?? []).length;
  const words = s.split(/\s+/).filter((w) => /^\p{L}{2,}[.,;:]?$/u.test(w)).length;
  return letters / nonSpace > 0.78 && math <= 2 && words >= 5 && !/\b(?:Figure|Fig\.|Table|Algorithm)\s*\d+\s*[:.]/i.test(s);
}

function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Calibrated triage: show a verdict only where the model is reliable on held-out data; otherwise "unclear". */
export function labelFromProbs(p: number[], nRefs = 1): SupportLabel {
  const [acc, nacc, nei] = p;
  const t = CLAIM_CONFIG.thresholds;
  if (acc >= t.supported && acc >= nacc && acc >= nei) return 'supported';
  // a sentence citing several works makes a joint claim; fault one work only if its text is clearly unrelated
  if (nRefs >= 3) return nei >= t.unrelatedMulti ? 'review' : 'unclear';
  if (nacc + nei >= t.review) return 'review';
  return 'unclear';
}

export async function runClaimChecks(my: number, current: () => number, get: Getter, set: Setter, http: Http) {
  const st = get();
  const doc = st.doc!;
  const results = st.results;
  const tasks: ClaimCheck[] = [];
  for (const c of doc.citances) {
    for (const ri of c.refIndices) {
      const r = results[ri];
      if (!r || !r.match || !['verified', 'verified_minor', 'metadata_error', 'retracted'].includes(r.verdict)) continue;
      if (c.claim.split(/\s+/).length < 5 || !isProse(c.claim)) continue;
      tasks.push({ citanceId: c.id, refIndex: ri, status: 'queued', evidence: [] });
      if (tasks.length >= MAX_TASKS) break;
    }
  }
  if (!tasks.length) {
    set({ claimPhase: 'done', claims: [] });
    return;
  }
  set({ claims: tasks, claimPhase: 'loading-model' });
  const update = (i: number, patch: Partial<ClaimCheck>) =>
    my === current() &&
    set((s) => {
      const claims = s.claims.slice();
      claims[i] = { ...claims[i], ...patch };
      return { claims };
    });

  // the model client is a separate chunk: if it cannot be fetched (connection lost) claims fall back to retrieval only
  const mlMod = await import('./mlClient').catch(() => null);
  let modelOk = true;
  const modelLoad = (mlMod ? mlMod.loadModels((l, t) => my === current() && set({ modelProgress: t ? l / t : 0 })) : Promise.reject(new Error('model client unavailable')))
    .then(() => my === current() && set({ claimPhase: 'running' }))
    .catch((e) => {
      console.error('Verifier model failed to load:', e);
      modelOk = false;
      if (my === current()) set({ claimPhase: 'unavailable' });
    });
  const ml = mlMod!; // only used while modelOk

  // fetch sources (deduplicated by reference), 3 at a time, while the model downloads
  const refs = [...new Set(tasks.map((t) => t.refIndex))];
  const sources = new Map<number, Promise<Source | null>>();
  let active = 0;
  const queue: (() => void)[] = [];
  const limited = <T,>(fn: () => Promise<T>) =>
    new Promise<T>((res, rej) => {
      const run = () => {
        active++;
        fn()
          .then(res, rej)
          .finally(() => {
            active--;
            queue.shift()?.();
          });
      };
      if (active < 3) run();
      else queue.push(run);
    });
  for (const ri of refs) sources.set(ri, limited(() => getSource(results[ri]!, http)));

  await modelLoad;
  // process each reference's claims as soon as its source text arrives (a slow download never blocks the rest)
  const pending = new Map(refs.map((ri) => [ri, sources.get(ri)!.then((s) => ({ ri, s }), () => ({ ri, s: null as Source | null }))]));
  const order: { i: number; src: Source | null }[] = [];
  while (pending.size) {
    const { ri, s } = await Promise.race(pending.values());
    pending.delete(ri);
    tasks.forEach((t, i) => t.refIndex === ri && order.push({ i, src: s }));
    await processBatch(order.splice(0));
  }
  if (my === current()) set({ claimPhase: 'done' });

  async function processBatch(batch: { i: number; src: Source | null }[]) {
    for (const { i, src } of batch) {
      if (my !== current()) return;
      await processOne(i, src);
    }
  }

  async function processOne(i: number, src: Source | null) {
    const t = tasks[i];
    const claim = doc.citances[t.citanceId].claim;
    if (!src) {
      update(i, { status: 'no_source', note: 'No abstract or open-access full text available' });
      return;
    }
    if (doc.citances[t.citanceId].kind === 'mention') {
      update(i, { status: 'done', label: 'mention', sourceKind: src.kind, evidence: [], note: 'Names or exemplifies the cited work; there is no claim to check' });
      return;
    }
    update(i, { status: 'running', sourceKind: src.kind });
    // hybrid retrieval: BM25 prefilter, then dense re-scoring of the candidates, fused by reciprocal rank
    const bmAll = bm25(claim, src.sentences);
    const cand = bmAll.map((s, j) => [s, j] as const).sort((a, b) => b[0] - a[0]).slice(0, CLAIM_CONFIG.prefilter).map(([, j]) => j);
    let fused = cand.map((j) => bmAll[j]);
    if (modelOk) {
      try {
        src.vecs ??= new Map();
        const missing = cand.filter((j) => !src.vecs!.has(j));
        if (missing.length) (await ml.embed(missing.map((j) => src.sentences[j]))).forEach((v, k) => src.vecs!.set(missing[k], v));
        const [q] = await ml.embed([claim], true);
        fused = rrf([cand.map((j) => bmAll[j]), cand.map((j) => cosine(src.vecs!.get(j)!, q))]);
      } catch {
        /* BM25 only */
      }
    }
    const order = cand.map((j, k) => [fused[k], j] as const).sort((a, b) => b[0] - a[0]).slice(0, CLAIM_CONFIG.topK);
    const evidence = order.map(([s, j]) => ({ text: src.sentences[j], score: s, section: src.kind }));
    if (!modelOk) {
      update(i, { status: 'done', evidence, note: 'Verifier model unavailable; showing retrieved evidence only' });
      return;
    }
    try {
      const evText = order
        .map(([, j]) => j)
        .sort((a, b) => a - b)
        .map((j) => src.sentences[j])
        .join(' ');
      const [p] = await ml.verifyPairs([{ claim, evidence: evText }]);
      const label = labelFromProbs(p, doc.citances[t.citanceId].refIndices.length);
      update(i, { status: 'done', evidence, probs: { ACCURATE: p[0], NOT_ACCURATE: p[1], NEI: p[2] }, label, unrelated: label === 'review' && p[2] > p[1] });
    } catch (e) {
      console.error('Claim verification failed:', e);
      update(i, { status: 'done', evidence, note: `Verifier error: ${(e as Error).message}` });
    }
  }
}
