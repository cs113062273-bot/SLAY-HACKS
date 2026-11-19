/**
 * Builds response snapshots for the bundled samples so they run instantly and are immune to API
 * throttling during demos. The browser still runs the full verification logic on these responses;
 * user documents always query the live indexes.
 * Usage: npx tsx scripts/build-seeds.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc, buildDocFromText } from '../src/core/doc';
import { Http, type Cache } from '../src/core/http';
import { pdfToLines } from '../src/core/pdf';
import { verifyReference } from '../src/core/verify';
import { FileCache } from './node-cache';

const base = new FileCache(fileURLToPath(new URL('../../data/cache/http.json', import.meta.url)));

class Recorder implements Cache {
  used: Record<string, unknown> = {};
  async get(k: string) {
    const v = await base.get(k);
    if (v !== undefined) this.used[k] = v;
    return v;
  }
  async set(k: string, v: unknown) {
    this.used[k] = v;
    await base.set(k, v);
  }
}

async function docFor(src: string) {
  if (src.endsWith('.txt')) return buildDocFromText(readFileSync(src, 'utf8'));
  const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(src)));
  return buildDoc(lines, pageWidths);
}

const SAMPLES = [
  { name: 'planted', src: 'public/samples/planted.txt' },
  { name: 'neurips', src: '../data/pdfs/p3_2510.21310v1.pdf' },
  { name: 'attention', src: '../data/pdfs/attention_1706.03762.pdf' },
];

for (const s of SAMPLES) {
  const rec = new Recorder();
  const http = new Http({ cache: rec, maxRetries: 8 });
  const doc = await docFor(s.src);
  let next = 0;
  const verdicts: string[] = [];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < doc.references.length) {
        const i = next++;
        verdicts[i] = (await verifyReference(doc.references[i], { http }, i)).verdict;
      }
    }),
  );
  writeFileSync(`public/samples/${s.name}.seed.json`, JSON.stringify(rec.used));
  const counts: Record<string, number> = {};
  for (const v of verdicts) counts[v] = (counts[v] ?? 0) + 1;
  console.log(s.name, doc.references.length, 'refs', Object.keys(rec.used).length, 'responses', counts);
}
base.flush();
process.exit(0);
