/**
 * Score the controlled error-injection set (data/stress/stress-set.json, built by stress-build.ts).
 * Positives = injected errors (should be flagged); negatives = unmodified controls + benign rewrites (should verify).
 * Reports precision / recall / F1, per-type detection, abstention (unchecked / not indexed), and field localisation:
 * whether a flag names the injected field rather than flagging the reference for some other reason.
 *
 * Live (fills a cache):  VERACITE_CACHE_PATH=../.runs/stress-http.json npx tsx scripts/bench-stress.ts live
 * Offline replay:        VERACITE_REPLAY="../.runs/stress-http.json;..." npx tsx scripts/bench-stress.ts <label>
 * Output: data/stress/results-<label>.json and .txt
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Http } from '../src/core/http';
import { FLAGGED_VERDICTS, type RefResult } from '../src/core/types';
import { verifyReference } from '../src/core/verify';
import { makeCache, replayMisses, replayRef } from './node-cache';
import type { Item } from './stress-build';

// an internal assertion in Node's fetch (undici) on a socket closed mid-response must not end a long run:
// the request itself times out through the Http layer's abort signal
process.on('uncaughtException', (e) => console.error(`uncaught (continuing): ${e.message}`));
const root = fileURLToPath(new URL('../../data/stress/', import.meta.url));
const label = process.argv[2] ?? 'run';
const only = process.env.STRESS_ONLY ? new RegExp(process.env.STRESS_ONLY) : null;
const set: { items: Item[] } = JSON.parse(readFileSync(`${root}stress-set.json`, 'utf8'));
const items = set.items.filter((x) => !only || only.test(x.type));
const replay = !!process.env.VERACITE_REPLAY;
const cache = makeCache('');
const http = new Http({ cache, maxRetries: replay ? 0 : 8 });

const res: RefResult[] = new Array(items.length);
let next = 0;
let done = 0;
const t0 = Date.now();
await Promise.all(
  Array.from({ length: Number(process.env.STRESS_CONCURRENCY ?? 6) }, async () => {
    while (next < items.length) {
      const i = next++;
      res[i] = await replayRef.run(i, () => verifyReference(items[i].raw, { http }, i));
      if (++done % 50 === 0) {
        console.error(`${done}/${items.length} ${Math.round((Date.now() - t0) / 1000)}s`);
        (cache as any).flush?.();
      }
    }
  }),
);
(cache as any).flush?.();

const flagged = (r: RefResult) => FLAGGED_VERDICTS.includes(r.verdict);
const abstain = (r: RefResult) => r.verdict === 'unchecked' || r.verdict === 'unverifiable';
/** does the result point at the injected field? */
function localised(it: Item, r: RefResult): boolean {
  const mis = (f: string) => r.checks.some((c) => c.field === f && c.status === 'mismatch');
  switch (it.field) {
    case 'identifier':
      return r.verdict === 'id_mismatch' || r.verdict === 'not_found' || mis('identifier');
    case 'existence':
      return r.verdict === 'fabricated' || r.verdict === 'not_found' || (r.verdict === 'metadata_error' && mis('title'));
    default:
      return mis(it.field!);
  }
}

interface Row { n: number; flagged: number; abstain: number; localised: number; unanswered: number }
const rows = new Map<string, Row>();
const add = (k: string, it: Item, r: RefResult, i: number) => {
  const row = rows.get(k) ?? { n: 0, flagged: 0, abstain: 0, localised: 0, unanswered: 0 };
  row.n++;
  if (flagged(r)) row.flagged++;
  if (abstain(r)) row.abstain++;
  if (it.truth === 'error' && flagged(r) && localised(it, r)) row.localised++;
  if (replayMisses.has(i) || r.sourcesFailed.length) row.unanswered++;
  rows.set(k, row);
};
items.forEach((it, i) => {
  add(it.type, it, res[i], i);
  add(it.truth === 'error' ? 'ALL errors' : 'ALL correct', it, res[i], i);
});
const P = rows.get('ALL errors') ?? { n: 0, flagged: 0, abstain: 0, localised: 0, unanswered: 0 };
const N = rows.get('ALL correct') ?? { n: 0, flagged: 0, abstain: 0, localised: 0, unanswered: 0 };
const tp = P.flagged;
const fp = N.flagged;
const prec = tp / Math.max(1, tp + fp);
const rec = tp / Math.max(1, P.n);
const f1 = (2 * prec * rec) / Math.max(1e-9, prec + rec);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');

const out: string[] = [];
out.push(`Stress set (${label}): ${items.length} items, ${P.n} injected errors, ${N.n} correct (controls + benign rewrites)${replay ? ' — offline replay' : ''}; ${Math.round((Date.now() - t0) / 1000)} s`);
out.push(`Precision ${prec.toFixed(3)}  Recall ${rec.toFixed(3)}  F1 ${f1.toFixed(3)}  |  false alarms on correct refs ${fp}/${N.n} (${pct(fp, N.n)}), abstained on correct ${pct(N.abstain, N.n)}, abstained on errors ${pct(P.abstain, P.n)}, flagged errors naming the injected field ${pct(P.localised, tp)}`);
out.push('');
out.push(`${'type'.padEnd(18)} ${'n'.padStart(4)}  ${'flagged'.padStart(8)}  ${'abstain'.padStart(8)}  ${'field ok'.padStart(9)}  unanswered`);
for (const [k, r] of [...rows].sort((a, b) => a[0].localeCompare(b[0]))) {
  const isErr = k.startsWith('err') || k === 'ALL errors';
  out.push(`${k.padEnd(18)} ${String(r.n).padStart(4)}  ${pct(r.flagged, r.n).padStart(8)}  ${pct(r.abstain, r.n).padStart(8)}  ${(isErr ? pct(r.localised, r.flagged) : '').padStart(9)}  ${r.unanswered}`);
}
// every miss and every false alarm, for root-cause analysis
out.push('\nMissed injected errors (not flagged):');
items.forEach((it, i) => {
  if (it.truth === 'error' && !flagged(res[i])) out.push(`  [${it.type}] ${res[i].verdict}${replayMisses.has(i) ? ` [${replayMisses.get(i)!.length} unrecorded]` : ''}  ${it.note ?? ''}\n      ${it.raw.slice(0, 200)}\n      ${res[i].checks.map((c) => `${c.field}:${c.status}`).join(' ')} | ${res[i].issues.join(' | ').slice(0, 200)}`);
});
out.push('\nFalse alarms on correct references:');
items.forEach((it, i) => {
  if (it.truth === 'correct' && flagged(res[i])) out.push(`  [${it.type}] ${res[i].verdict}${replayMisses.has(i) ? ` [${replayMisses.get(i)!.length} unrecorded]` : ''}  ${it.raw.slice(0, 200)}\n      ${res[i].issues.join(' | ').slice(0, 240)}`);
});
const text = out.join('\n');
console.log(text);
writeFileSync(`${root}results-${label}.txt`, text + '\n');
writeFileSync(
  `${root}results-${label}.json`,
  JSON.stringify({ label, replay, precision: prec, recall: rec, f1, rows: Object.fromEntries(rows), items: items.map((it, i) => ({ id: it.id, type: it.type, truth: it.truth, verdict: res[i].verdict, localised: it.truth === 'error' ? localised(it, res[i]) : undefined, unrecorded: replayMisses.get(i)?.length ?? 0, failed: res[i].sourcesFailed })) }, null, 1),
);
process.exit(0);
