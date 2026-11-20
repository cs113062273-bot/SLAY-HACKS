/**
 * Parse-only evaluation of PDF reference extraction against ground truth from the papers' own .bbl files
 * (data/parser_dev/truth.tsv, built by scripts/parser-corpus.sh). No network.
 * Per paper: references parsed vs bibitems (completeness), and field health of the parsed entries.
 * Usage: npx tsx scripts/parser-eval.ts [--verbose] [--show <file-substring>]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc } from '../src/core/doc';
import { pdfToLines } from '../src/core/pdf';

const root = fileURLToPath(new URL('../../data/', import.meta.url));
const verbose = process.argv.includes('--verbose');
const si = process.argv.indexOf('--show');
const show = si > 0 ? process.argv[si + 1] : '';
const rows = readFileSync(`${root}parser_dev/truth.tsv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));

// an "author" that is really debris from a misplaced author/title boundary
const DEBRIS = /^(?:arxiv|preprint|proceedings|proc|journal|conference|in|and|the|of|for|on|vol|pp|ieee|acm|springer|org|http|https|doi|url|available|online)$/i;
const debrisAuthor = (f: string) => DEBRIS.test(f) || /^\p{Ll}/u.test(f) || /\d/.test(f) || f.split(/\s+/).length > 4;

let totT = 0, totP = 0, zero = 0, n = 0;
const agg = { noTitle: 0, noAuthor: 0, noYear: 0, debris: 0, refs: 0 };
const lines: string[] = [];
for (const [file, cat, , bib] of rows.filter(([f]) => !show || f.includes(show))) {
  const truth = Number(bib);
  let refs: any[] = [];
  let raw: string[] = [];
  try {
    const { lines: L, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(`${root}pdfs/parser_dev/${file}`)));
    const d = buildDoc(L, pageWidths);
    refs = d.references;
    raw = d.rawReferences;
  } catch (e) {
    lines.push(`ERR ${file} ${String(e).slice(0, 80)}`);
  }
  n++;
  totT += truth;
  totP += Math.min(refs.length, truth);
  if (!refs.length) zero++;
  const h = { noTitle: 0, noAuthor: 0, noYear: 0, debris: 0 };
  for (const r of refs) {
    if (!r.title) h.noTitle++;
    if (!r.authors.length) h.noAuthor++;
    if (!r.year) h.noYear++;
    if (r.authors.some((a: any) => debrisAuthor(a.family))) h.debris++;
  }
  for (const k of Object.keys(h) as (keyof typeof h)[]) agg[k] += h[k];
  agg.refs += refs.length;
  const comp = refs.length / truth;
  const flag = comp < 0.9 || comp > 1.1 ? '!!' : '  ';
  lines.push(`${flag} ${String(refs.length).padStart(4)}/${String(truth).padEnd(4)} ${(comp * 100).toFixed(0).padStart(4)}%  noT ${h.noTitle} noA ${h.noAuthor} noY ${h.noYear} deb ${h.debris}  ${cat} ${file}`);
  if (show && file.includes(show)) for (const [i, r] of refs.entries()) console.log(`[${i + 1}] ${raw[i]?.slice(0, 220)}\n     A=${r.authors.map((a: any) => a.family).join('; ')} | T=${r.title} | V=${r.venue} | Y=${r.year}`);
}
if (verbose || !show) console.log(lines.join('\n'));
const pct = (x: number) => `${((x / Math.max(1, agg.refs)) * 100).toFixed(1)}%`;
console.log(`\npapers ${n}, extraction failures ${zero}, completeness ${((totP / totT) * 100).toFixed(1)}% (${totP}/${totT} bibitems, capped per paper)`);
console.log(`parsed refs ${agg.refs}: no title ${pct(agg.noTitle)}, no author ${pct(agg.noAuthor)}, no year ${pct(agg.noYear)}, debris author ${pct(agg.debris)}`);
process.exit(0);
