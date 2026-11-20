/** Count regression on spent blind sets; never an independent accuracy estimate. No network. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc } from '../src/core/doc';
import { pdfToLines } from '../src/core/pdf';

const root = fileURLToPath(new URL('../../data/', import.meta.url));
for (const set of ['blind', 'blind2']) {
  const truth = JSON.parse(readFileSync(`${root}${set}/truth.json`, 'utf8'));
  const frozen = JSON.parse(readFileSync(`${root}${set}/results.json`, 'utf8'));
  const papers = [];
  for (const p of frozen.papers) {
    const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(`${root}pdfs/${set}/${p.file}`)));
    const doc = buildDoc(lines, pageWidths);
    papers.push({ file: p.file, truth: truth[p.file]?.n ?? null, how: truth[p.file]?.how ?? null, old: p.refs, current: doc.references.length });
  }
  const known = papers.filter((p) => p.truth !== null);
  const sum = (f: (p: typeof papers[number]) => number) => known.reduce((s, p) => s + f(p), 0);
  const denominator = sum((p) => p.truth);
  const summary = { set, papers: known.length, denominator, old: sum((p) => Math.min(p.old, p.truth)), current: sum((p) => Math.min(p.current, p.truth)), excess: sum((p) => Math.max(0, p.current - p.truth)), papersWithNoReferences: papers.filter((p) => !p.current).length };
  console.log(JSON.stringify(summary));
  writeFileSync(`${root}${set}/parser-regression.json`, JSON.stringify({ summary, papers, caveat: 'Spent sets. Count completeness capped per paper, not field accuracy. cite truth is approximate; references in separately numbered supplements are not included by the parser.' }, null, 2) + '\n');
}
process.exit(0);
