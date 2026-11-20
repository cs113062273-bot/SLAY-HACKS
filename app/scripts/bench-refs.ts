/**
 * Benchmark: Badalova & Mayr (2026) manual reference verification set (Zenodo 10.5281/zenodo.21457492).
 * 104 references, 33 problematic. Compares Veracite with the five tools' published outputs.
 * Usage: npx tsx scripts/bench-refs.ts [--verbose] [--only P3]
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Http } from '../src/core/http';
import { FLAGGED_VERDICTS, type RefResult } from '../src/core/types';
import { verifyReference } from '../src/core/verify';
import { loadBench } from './bench-data';
import { FileCache } from './node-cache';

const verbose = process.argv.includes('--verbose');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : undefined;

const cache = new FileCache(process.env.VERACITE_CACHE_PATH ?? fileURLToPath(new URL('../../data/cache/http.json', import.meta.url)));
const http = new Http({ cache, maxRetries: 8 });

const rows = loadBench().filter((r) => !only || r.doc === only);

function metrics(pred: boolean[], gold: boolean[]) {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  pred.forEach((p, i) => {
    const g = gold[i];
    if (p && g) tp++;
    else if (p && !g) fp++;
    else if (!p && g) fn++;
    else tn++;
  });
  const rec = tp / (tp + fn || 1);
  const spec = tn / (tn + fp || 1);
  const prec = tp / (tp + fp || 1);
  const f1 = (2 * prec * rec) / (prec + rec || 1);
  const acc = (tp + tn) / pred.length;
  return { tp, fn, fp, tn, rec, spec, prec, f1, acc };
}

async function main() {
  const results: RefResult[] = new Array(rows.length);
  let next = 0;
  const t0 = Date.now();
  async function worker() {
    while (next < rows.length) {
      const i = next++;
      results[i] = await verifyReference(rows[i].reference, { http }, i);
      process.stderr.write('.');
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  cache.flush();
  process.stderr.write(`\n${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const gold = rows.map((r) => r.label === 'problematic');
  const ours = results.map((r) => FLAGGED_VERDICTS.includes(r.verdict));
  const table: Record<string, ReturnType<typeof metrics>> = {};
  for (const t of ['checkifexist', 'hallucitechecker', 'hallucinator', 'halref', 'refchecker']) table[t] = metrics(rows.map((r) => r.tools[t]), gold);
  table['VERACITE'] = metrics(ours, gold);

  const fmt = (x: number) => x.toFixed(3);
  console.log('\nTool               TP  FN  FP  TN   Recall  Spec   Prec   F1     Acc');
  for (const [k, m] of Object.entries(table)) console.log(`${k.padEnd(17)} ${String(m.tp).padStart(3)} ${String(m.fn).padStart(3)} ${String(m.fp).padStart(3)} ${String(m.tn).padStart(3)}   ${fmt(m.rec)}  ${fmt(m.spec)}  ${fmt(m.prec)}  ${fmt(m.f1)}  ${fmt(m.acc)}`);

  console.log('\nErrors:');
  results.forEach((r, i) => {
    const g = gold[i];
    const p = ours[i];
    if (g !== p || verbose) {
      console.log(`${g !== p ? (p ? 'FP' : 'FN') : 'ok'} ${rows[i].doc} ${rows[i].num} gold=${rows[i].label} → ${r.verdict} (${r.confidence.toFixed(2)}) failed=[${r.sourcesFailed}]`);
      console.log(`   REF: ${rows[i].reference.slice(0, 200)}`);
      if (r.match) console.log(`   MATCH[${r.match.source}]: ${r.match.title} | ${r.match.authors.slice(0, 6).map((a) => a.family).join(', ')} | ${r.match.years.join('/')} | ${r.match.venue ?? ''}`);
      for (const c of r.checks.filter((c) => c.status !== 'match' && c.status !== 'na')) console.log(`   ${c.field}:${c.status} ${c.note ?? ''} cited=${(c.cited ?? '').slice(0, 80)} found=${(c.found ?? '').slice(0, 80)}`);
      for (const s of r.issues) console.log(`   ! ${s}`);
    }
  });
  writeFileSync(new URL('../../data/bench-refs-results.json', import.meta.url), JSON.stringify({ table, results: results.map((r, i) => ({ id: `${rows[i].doc} ${rows[i].num}`, gold: rows[i].label, verdict: r.verdict, issues: r.issues })) }, null, 1));
  process.exit(0);
}
main();
