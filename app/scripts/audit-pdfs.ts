/**
 * Full reference audit of arbitrary PDFs (same core as the browser): parsing stats, verdicts, and every
 * flagged reference with its evidence so false alarms can be judged by hand.
 * Usage: npx tsx scripts/audit-pdfs.ts <pdf> [<pdf> …]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc } from '../src/core/doc';
import { Http } from '../src/core/http';
import { pdfToLines } from '../src/core/pdf';
import { FLAGGED_VERDICTS, type RefResult } from '../src/core/types';
import { verifyReference } from '../src/core/verify';
import { FileCache } from './node-cache';

const cache = new FileCache(fileURLToPath(new URL('../../data/cache/http.json', import.meta.url)));
const http = new Http({ cache, maxRetries: 6 });

for (const f of process.argv.slice(2)) {
  const t0 = Date.now();
  const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(f)));
  const doc = buildDoc(lines, pageWidths);
  const tParse = Date.now() - t0;
  const res: RefResult[] = new Array(doc.references.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < doc.references.length) {
        const i = next++;
        res[i] = await verifyReference(doc.references[i], { http, budgetMs: 60000 }, i);
      }
    }),
  );
  cache.flush();
  const counts: Record<string, number> = {};
  for (const r of res) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  const linked = new Set(doc.citances.flatMap((c) => c.refIndices)).size;
  console.log(`\n=== ${f.split(/[\\/]/).pop()} | pages ${doc.stats.pages} | refs ${doc.references.length} | citances ${doc.citances.length} (${doc.style}) | refs cited in text ${linked}/${doc.references.length} | parse ${tParse} ms | verify ${((Date.now() - t0 - tParse) / 1000).toFixed(0)} s`);
  console.log('   ', JSON.stringify(counts));
  res.forEach((r, i) => {
    if (!FLAGGED_VERDICTS.includes(r.verdict) && r.verdict !== 'unchecked') return;
    console.log(`  [${i + 1}] ${r.verdict}: ${doc.references[i].raw.slice(0, 230)}`);
    if (r.match) console.log(`      MATCH[${r.match.source}] ${r.match.title.slice(0, 100)} | ${r.match.authors.slice(0, 4).map((a) => a.family).join(', ')} | ${r.match.years.join('/')} | ${r.match.venue ?? ''}`);
    for (const s of r.issues.slice(0, 3)) console.log(`      ! ${s.slice(0, 200)}`);
  });
}
process.exit(0);
