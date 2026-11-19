/** Dump parsed references of PDFs as JSON (raw + parse) for inspection. Usage: npx tsx scripts/dump-refs.ts out.json <pdf>… */
import { readFileSync, writeFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc } from '../src/core/doc';
import { pdfToLines } from '../src/core/pdf';
const out: Record<string, unknown[]> = {};
for (const f of process.argv.slice(3)) {
  const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(f)));
  const doc = buildDoc(lines, pageWidths);
  out[f.split(/[\/]/).pop()!] = doc.references.map((r) => ({ raw: r.raw, title: r.title, authors: r.authors.map((a) => a.family), year: r.year, venue: r.venue, dois: r.dois, kind: r.kind, etAl: r.etAl }));
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
