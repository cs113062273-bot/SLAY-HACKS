import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc } from './src/core/doc';
import { Http } from './src/core/http';
import { pdfToLines } from './src/core/pdf';
import { verifyReference } from './src/core/verify';
import { FileCache } from './scripts/node-cache';
const cache = new FileCache(fileURLToPath(new URL('../data/cache/http.json', import.meta.url)));
const http = new Http({ cache });
const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync('../data/pdfs/' + process.argv[2])));
const doc = buildDoc(lines, pageWidths);
for (let i = 0; i < doc.references.length; i++) {
  const r = await verifyReference(doc.references[i], { http }, i);
  if (r.verdict === 'verified' || r.verdict === 'verified_minor') continue;
  console.log(`[${i + 1}] ${r.verdict} :: ${doc.references[i].raw.slice(0, 200)}`);
  if (r.match) console.log(`   MATCH[${r.match.source}] ${r.match.title} | ${r.match.authors.slice(0, 6).map((a) => a.family).join(', ')} | ${r.match.years} | ${r.match.venue}`);
  for (const s of r.issues) console.log('   ! ' + s);
}
process.exit(0);
