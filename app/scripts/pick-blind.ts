/**
 * Pre-registered selection for the blind real-paper test. The rule is fixed here before any paper is run:
 *  - arXiv: for each category below (none used during development), the most recently submitted paper whose
 *    PRIMARY category is that category (arXiv API, sortBy=submittedDate desc).
 *  - PLOS ONE: the two most recently published research articles (PLOS search API).
 *  - A paper is skipped only if its PDF cannot be downloaded or yields fewer than 10 references; the
 *    next one in the same listing replaces it. Skips are recorded in the manifest.
 * Writes data/blind/manifest.json and the PDFs to data/pdfs/blind/.
 * Usage: npx tsx scripts/pick-blind.ts            (set 1, data/blind/)
 *        BLIND_SET=2 npx tsx scripts/pick-blind.ts (set 2, data/blind2/: new categories, picked after set 1 was run;
 *        papers already picked in an earlier set are excluded)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc } from '../src/core/doc';
import { pdfToLines } from '../src/core/pdf';

const SET = process.env.BLIND_SET && process.env.BLIND_SET !== '1' ? process.env.BLIND_SET : '';
const SETS: Record<string, string[]> = {
  '': ['cs.CL', 'cs.CV', 'cs.SE', 'cs.HC', 'astro-ph.GA', 'cond-mat.mtrl-sci', 'quant-ph', 'math.PR', 'q-bio.NC', 'eess.SP', 'econ.EM', 'stat.ME'],
  // set 2: none of these categories was used in development or in set 1
  '2': ['cs.CR', 'cs.RO', 'cs.DB', 'physics.optics', 'cond-mat.stat-mech', 'hep-ph', 'math.AP', 'q-bio.GN', 'eess.SY', 'stat.ML', 'physics.chem-ph', 'gr-qc'],
};
export const CATEGORIES = SETS[SET];
const root = fileURLToPath(new URL('../../data/', import.meta.url));
const B = `blind${SET}`;
mkdirSync(`${root}${B}`, { recursive: true });
mkdirSync(`${root}pdfs/${B}`, { recursive: true });
// papers picked in earlier sets are never picked again
const seen = new Set<string>();
for (const d of ['blind', 'blind2', 'blind3']) if (d !== B && existsSync(`${root}${d}/manifest.json`)) for (const x of JSON.parse(readFileSync(`${root}${d}/manifest.json`, 'utf-8')).picked) seen.add(x.id);
const UA = { 'User-Agent': 'veracite-benchmark/1.0 (research evaluation script)' };

async function refsIn(buf: Uint8Array) {
  const { lines, pageWidths } = await pdfToLines(pdfjs as any, buf);
  return buildDoc(lines, pageWidths).references.length;
}

// --plos-only: keep the arXiv picks already in the manifest (re-querying arXiv later would change the selection)
const plosOnly = process.argv.includes('--plos-only') && existsSync(`${root}${B}/manifest.json`);
const manifest: { picked: any[]; skipped: any[]; rule: string; queriedAt: string; plosQueriedAt?: string } = plosOnly ? JSON.parse(readFileSync(`${root}${B}/manifest.json`, 'utf-8')) : {
  rule: 'most recent primary-category arXiv submission per category; two most recent PLOS ONE research articles; skip only if PDF fails or <10 references',
  queriedAt: new Date().toISOString(),
  picked: [],
  skipped: [],
};

if (plosOnly) {
  manifest.picked = manifest.picked.filter((p) => p.source !== 'PLOS ONE');
  manifest.skipped = manifest.skipped.filter((p) => p.source !== 'PLOS ONE');
  manifest.plosQueriedAt = new Date().toISOString();
}
for (const cat of plosOnly ? [] : CATEGORIES) {
  const url = `http://export.arxiv.org/api/query?search_query=cat:${cat}&sortBy=submittedDate&sortOrder=descending&max_results=25`;
  const xml = await (await fetch(url, { headers: UA })).text();
  const entries = xml.split('<entry>').slice(1);
  let got = false;
  for (const e of entries) {
    const id = e.match(/<id>http:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/)?.[1];
    const primary = e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1];
    const title = e.match(/<title>([\s\S]*?)<\/title>/)?.[1].replace(/\s+/g, ' ').trim();
    if (!id || primary !== cat || seen.has(id)) continue;
    const file = `${cat}_${id.replace('/', '_')}.pdf`;
    try {
      const r = await fetch(`https://arxiv.org/pdf/${id}`, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      const n = await refsIn(buf.slice());
      if (n < 10) {
        manifest.skipped.push({ cat, id, title, reason: `${n} references parsed` });
        continue;
      }
      writeFileSync(`${root}pdfs/${B}/${file}`, buf);
      manifest.picked.push({ source: 'arXiv', cat, id, title, file, refsParsed: n });
      console.log(`${cat}: ${id} (${n} refs) ${title?.slice(0, 80)}`);
      got = true;
      break;
    } catch (err) {
      manifest.skipped.push({ cat, id, title, reason: String(err) });
    }
    await new Promise((r) => setTimeout(r, 3000)); // arXiv asks for ≥3 s between requests
  }
  if (!got) console.log(`${cat}: nothing picked`);
  await new Promise((r) => setTimeout(r, 3000));
}

const plos = await (await fetch('https://api.plos.org/search?q=journal:%22PLOS%20ONE%22%20AND%20article_type:%22Research%20Article%22&fq=doc_type:full&sort=publication_date%20desc&rows=10&fl=id,title_display,publication_date', { headers: UA })).json();
let nPlos = 0;
for (const d of plos.response.docs) {
  if (nPlos >= 2) break;
  if (seen.has(d.id)) continue;
  const file = `plos_${d.id.replace(/[/.]/g, '_')}.pdf`;
  try {
    const r = await fetch(`https://journals.plos.org/plosone/article/file?id=${d.id}&type=printable`, { headers: UA });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    const n = await refsIn(buf.slice());
    if (n < 10) {
      manifest.skipped.push({ source: 'PLOS ONE', id: d.id, reason: `${n} references parsed` });
      continue;
    }
    writeFileSync(`${root}pdfs/${B}/${file}`, buf);
    manifest.picked.push({ source: 'PLOS ONE', id: d.id, title: d.title_display, published: d.publication_date, file, refsParsed: n });
    console.log(`PLOS ONE: ${d.id} (${n} refs) ${String(d.title_display).slice(0, 80)}`);
    nPlos++;
  } catch (err) {
    manifest.skipped.push({ source: 'PLOS ONE', id: d.id, reason: String(err) });
  }
}
writeFileSync(`${root}${B}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(`picked ${manifest.picked.length}, skipped ${manifest.skipped.length}`);
process.exit(0);
