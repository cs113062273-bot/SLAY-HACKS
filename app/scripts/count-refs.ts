/** Parse-only reference counts per PDF (no network). Usage: npx tsx scripts/count-refs.ts <pdf>... (SHOW=1 prints first/last entries) */
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfToLines } from '../src/core/pdf';
import { buildDoc } from '../src/core/doc';
for (const f of process.argv.slice(2)) {
  const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(f)));
  const d = buildDoc(lines, pageWidths);
  console.log(`${d.references.length}\t${d.citances.length}\t${d.sentences.length}\t${f.split('/').pop()}`);
  if (process.env.SHOW) for (const r of d.rawReferences.slice(0, 3).concat(d.rawReferences.slice(-2))) console.log('   ', r.slice(0, 150));
}
