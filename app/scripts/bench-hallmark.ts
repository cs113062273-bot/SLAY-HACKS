/**
 * HALLMARK benchmark (Reizinger et al., arXiv:2607.18360; github.com/rpatrik96/hallmark), v1.2 splits.
 * Develop on dev_public (optionally a stratified sample); score test_public once.
 * Usage: npx tsx scripts/bench-hallmark.ts --split dev_public --per-type 15 --valid 150
 *        npx tsx scripts/bench-hallmark.ts --split test_public
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsedFromBib } from '../src/core/bibtex';
import { Http } from '../src/core/http';
import { FLAGGED_VERDICTS, type RefResult } from '../src/core/types';
import { verifyReference } from '../src/core/verify';
import { FileCache } from './node-cache';

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const split = arg('--split', 'dev_public')!;
const perType = arg('--per-type') ? +arg('--per-type')! : 0;
const nValid = arg('--valid') ? +arg('--valid')! : 0;
const verbose = process.argv.includes('--verbose');

const root = fileURLToPath(new URL('../../data/hallmark/data/v1.2/', import.meta.url));
let rows = readFileSync(root + `${split}.jsonl`, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

// deterministic stratified sample (by hash of the key) for fast development loops
if (perType || nValid) {
  const byType = new Map<string, any[]>();
  for (const r of rows) {
    const t = r.label === 'VALID' ? 'VALID' : r.hallucination_type;
    byType.set(t, [...(byType.get(t) ?? []), r]);
  }
  rows = [];
  for (const [t, rs] of byType) {
    rs.sort((a, b) => (a.bibtex_key < b.bibtex_key ? -1 : 1));
    rows.push(...rs.slice(0, t === 'VALID' ? nValid : perType));
  }
}

const cache = new FileCache(process.env.VERACITE_CACHE_PATH ?? fileURLToPath(new URL('../../data/cache/http.json', import.meta.url)));
const http = new Http({ cache, maxRetries: 6 });

const results: RefResult[] = new Array(rows.length);
let next = 0;
const t0 = Date.now();
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < rows.length) {
      const i = next++;
      const p = parsedFromBib(rows[i].fields, rows[i].bibtex_type);
      try {
        results[i] = await verifyReference(p, { http }, i);
      } catch (e) {
        results[i] = { index: i, parsed: p, verdict: 'not_found', confidence: 0.5, checks: [], issues: [String(e)], candidates: [], sourcesQueried: [], sourcesFailed: [] };
      }
      if (i % 20 === 0) process.stderr.write(`${i} `);
    }
  }),
);
cache.flush();

// One delayed retry pass for flagged entries where an index failed (what the UI asks users to do).
// (a host disabled for a spent daily allowance will not recover within this run)
const spent = new Set([...http.disabled].map((h) => (h.includes('openalex') ? 'openalex' : h.includes('semanticscholar') ? 'semanticscholar' : h)));
const retry = results.map((r, i) => ({ r, i })).filter(({ r }) => FLAGGED_VERDICTS.includes(r.verdict) && r.sourcesFailed.some((s) => !spent.has(s)));
if (retry.length) {
  process.stderr.write(`\nretrying ${retry.length} entries with failed sources after 60s\n`);
  await new Promise((r) => setTimeout(r, 60000));
  for (const { i } of retry) {
    try {
      results[i] = await verifyReference(parsedFromBib(rows[i].fields, rows[i].bibtex_type), { http }, i);
    } catch {
      /* keep first result */
    }
  }
  cache.flush();
}

const pred = results.map((r) => FLAGGED_VERDICTS.includes(r.verdict));
const gold = rows.map((r) => r.label === 'HALLUCINATED');
let tp = 0,
  fp = 0,
  fn = 0,
  tn = 0;
pred.forEach((p, i) => (p && gold[i] ? tp++ : p ? fp++ : gold[i] ? fn++ : tn++));
const dr = tp / (tp + fn);
const fpr = fp / (fp + tn);
const prec = tp / (tp + fp);
const f1 = (2 * prec * dr) / (prec + dr);
console.log(`\nHALLMARK ${split}${perType ? ` (sample ${rows.length})` : ''}: n=${rows.length} DR=${dr.toFixed(3)} FPR=${fpr.toFixed(3)} P=${prec.toFixed(3)} F1=${f1.toFixed(3)}  [${((Date.now() - t0) / 1000).toFixed(0)}s]`);

const types = new Map<string, [number, number]>();
rows.forEach((r, i) => {
  const t = r.label === 'VALID' ? 'VALID (flagged=FP)' : r.hallucination_type;
  const [a, b] = types.get(t) ?? [0, 0];
  types.set(t, [a + (pred[i] ? 1 : 0), b + 1]);
});
for (const [t, [a, b]] of [...types].sort()) console.log(`  ${t.padEnd(26)} ${a}/${b}  ${(a / b).toFixed(2)}`);

const out = rows.map((r, i) => ({ bibtex_key: r.bibtex_key, label: pred[i] ? 'HALLUCINATED' : 'VALID', confidence: pred[i] ? 1 - results[i].confidence : results[i].confidence, reason: results[i].issues.join(' | ') }));
writeFileSync(fileURLToPath(new URL(`../../data/hallmark_${split}_veracite.jsonl`, import.meta.url)), out.map((o) => JSON.stringify(o)).join('\n'));

if (verbose) {
  rows.forEach((r, i) => {
    if (pred[i] === gold[i]) return;
    const res = results[i];
    console.log(`${pred[i] ? 'FP' : 'FN'} [${r.hallucination_type ?? 'VALID'}] ${res.verdict} | ${JSON.stringify(r.fields).slice(0, 200)}`);
    if (r.explanation) console.log(`   WHY: ${r.explanation.slice(0, 160)}`);
    if (res.match) console.log(`   MATCH[${res.match.source}]: ${res.match.title} | ${res.match.authors.slice(0, 5).map((a) => a.family).join(', ')} | ${res.match.years.join('/')} | ${res.match.venue ?? ''}`);
    for (const s of res.issues) console.log(`   ! ${s}`);
  });
}
process.exit(0);
