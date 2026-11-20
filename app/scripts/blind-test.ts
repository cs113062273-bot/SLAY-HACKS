/**
 * Frozen blind test on the papers in data/blind/manifest.json (selected by scripts/pick-blind.ts before any run).
 * Same core and settings as the browser (6 workers, 40 s budget per reference), with an EMPTY cache so every
 * lookup is live and timings are cold. Run once; results are reported as they come out.
 * Output: data/blind/results.json (per paper: counts, coverage, timing, every flag with evidence) and
 *         data/blind/miss_sample.txt (seeded random sample of verified references for a manual miss check).
 * Usage: npx tsx scripts/blind-test.ts   (BLIND_SET=2 for data/blind2/)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc } from '../src/core/doc';
import { Http, type HttpEvent } from '../src/core/http';
import { pdfToLines } from '../src/core/pdf';
import { FLAGGED_VERDICTS, type RefResult } from '../src/core/types';
import { verifyReference } from '../src/core/verify';

const root = fileURLToPath(new URL('../../data/', import.meta.url));
const B = process.env.BLIND_SET && process.env.BLIND_SET !== '1' ? `blind${process.env.BLIND_SET}` : 'blind';
const manifest = JSON.parse(readFileSync(`${root}${B}/manifest.json`, 'utf-8'));
const commit = execSync('git rev-parse --short HEAD').toString().trim();
const dirty = execSync('git status --porcelain -- src').toString().trim().length > 0;

// in-memory cache only: nothing from earlier runs is reused
const mem = new Map<string, unknown>();
const cache = { get: async (k: string) => mem.get(k), set: async (k: string, v: unknown) => void mem.set(k, v) };
const hostStats: Record<string, Record<string, number>> = {};
const onEvent = (e: HttpEvent) => {
  const h = (hostStats[e.host] ??= {});
  h[String(e.status)] = (h[String(e.status)] ?? 0) + 1;
};
const http = new Http({ cache: cache as any, maxRetries: 5, onEvent });

let seed = 20261120;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const out: any = { commit, srcDirty: dirty, startedAt: new Date().toISOString(), node: process.version, papers: [] };
const missLines: string[] = [];
for (const p of manifest.picked) {
  const t0 = Date.now();
  const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(`${root}pdfs/${B}/${p.file}`)));
  const doc = buildDoc(lines, pageWidths);
  const tParse = Date.now() - t0;
  const res: RefResult[] = new Array(doc.references.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < doc.references.length) {
        const i = next++;
        try {
          res[i] = await verifyReference(doc.references[i], { http, budgetMs: 40000 }, i);
        } catch (e) {
          res[i] = { index: i, parsed: doc.references[i], verdict: 'unchecked', confidence: 0.5, checks: [], issues: [`Check failed: ${(e as Error).message}`], candidates: [], sourcesQueried: [], sourcesFailed: [] } as RefResult;
        }
      }
    }),
  );
  const tVerify = Date.now() - t0 - tParse;
  const counts: Record<string, number> = {};
  for (const r of res) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  const n = res.length;
  const verified = (counts.verified ?? 0) + (counts.verified_minor ?? 0);
  const flags = res
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => FLAGGED_VERDICTS.includes(r.verdict))
    .map(({ r, i }) => ({
      n: i + 1,
      verdict: r.verdict,
      raw: doc.references[i].raw,
      issues: r.issues,
      match: r.match && { source: r.match.source, title: r.match.title, authors: r.match.authors.slice(0, 6).map((a) => a.family), years: r.match.years, venue: r.match.venue, doi: r.match.doi },
      judgement: '', // filled in by hand after the run: real error / false alarm
    }));
  const row = {
    ...p,
    pages: doc.stats.pages,
    refs: n,
    citances: doc.citances.length,
    style: doc.style,
    parseMs: tParse,
    verifyMs: tVerify,
    counts,
    coverage: n ? verified / n : 0,
    unverifiableShare: n ? (counts.unverifiable ?? 0) / n : 0,
    uncheckedShare: n ? (counts.unchecked ?? 0) / n : 0,
    flagged: flags.length,
    flags,
  };
  out.papers.push(row);
  console.log(`${p.file}: ${n} refs, verified ${verified} (${(row.coverage * 100).toFixed(0)}%), flagged ${flags.length}, unverifiable ${counts.unverifiable ?? 0}, unchecked ${counts.unchecked ?? 0}, ${(tVerify / 1000).toFixed(0)} s`);
  // miss check: 3 random verified references per paper, cited text next to the matched record
  const pool = res.map((r, i) => ({ r, i })).filter(({ r }) => r.verdict === 'verified' || r.verdict === 'verified_minor');
  for (let k = 0; k < 3 && pool.length; k++) {
    const { r, i } = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    missLines.push(`## ${p.file} [${i + 1}] ${r.verdict}\nCITED: ${doc.references[i].raw}\nMATCH: ${r.match?.title} | ${r.match?.authors.map((a) => a.family).join(', ')} | ${r.match?.years.join('/')} | ${r.match?.venue ?? ''} | ${r.match?.doi ?? r.match?.url ?? ''}\nJUDGEMENT: \n`);
  }
  writeFileSync(`${root}${B}/results.json`, JSON.stringify(out, null, 1));
}
out.finishedAt = new Date().toISOString();
out.hostStats = hostStats;
const all = out.papers;
const sum = (f: (x: any) => number) => all.reduce((a: number, x: any) => a + f(x), 0);
out.totals = {
  papers: all.length,
  refs: sum((x) => x.refs),
  verified: sum((x) => (x.counts.verified ?? 0) + (x.counts.verified_minor ?? 0)),
  flagged: sum((x) => x.flagged),
  unverifiable: sum((x) => x.counts.unverifiable ?? 0),
  unchecked: sum((x) => x.counts.unchecked ?? 0),
  verifySeconds: Math.round(sum((x) => x.verifyMs) / 1000),
};
writeFileSync(`${root}${B}/results.json`, JSON.stringify(out, null, 1));
writeFileSync(`${root}${B}/miss_sample.txt`, missLines.join('\n'));
console.log(JSON.stringify(out.totals), JSON.stringify(hostStats));
process.exit(0);
