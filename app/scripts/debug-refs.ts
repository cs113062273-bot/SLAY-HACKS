/** Show where the reference section was found in a PDF and its first lines (parser debugging, no network).
 * Usage: npx tsx scripts/debug-refs.ts <pdf> [lines=30] */
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { findReferenceRange, orderLines } from '../src/core/doc';
import { pdfToLines } from '../src/core/pdf';

const n = Number(process.argv[3] ?? 30);
const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(process.argv[2])));
const L = orderLines(lines as any, pageWidths);
const r = findReferenceRange(L);
console.log('lines', L.length, 'range', r);
const heads = L.map((l, i) => [i, l] as const).filter(([, l]) => /^(?:[0-9IVX]+\.?\s*)?(references|bibliography|literature cited|works cited)\b/i.test(l.text.trim()));
console.log('heading-like lines:', heads.map(([i, l]) => `${i}:p${l.page}:"${l.text.slice(0, 40)}"`).join(' | ') || 'none');
const from = r ? r[0] - 1 : Math.max(0, L.length - n);
for (const l of L.slice(from, from + n)) console.log(`p${l.page} c${(l as any).col ?? '-'} x${Math.round(l.x)} s${l.size.toFixed(1)}${l.bold ? 'b' : ' '} | ${l.text.slice(0, 110)}`);
