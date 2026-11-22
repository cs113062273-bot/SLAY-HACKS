/**
 * Controlled error-injection set built from real PDF reference strings (spent blind sets 1-3, development only).
 *
 * Stage 1 (base pool): parse every spent-set PDF and verify each reference by OFFLINE REPLAY of recorded responses.
 *   A reference enters the pool only if it verified cleanly (title, authors and year all "match", no unrecorded
 *   lookup), its parsed title and year appear verbatim in the string, and it has at least one author.
 * Stage 2 (injection, seeded): every base yields an unmodified control, two benign rewrites that must still verify,
 *   and three controlled errors assigned in rotation so each error type gets about the same count. An injected
 *   string is kept only if re-parsing it shows the intended change (and nothing else broke), so a failed edit never
 *   counts as a "missed error".
 *
 * Usage: VERACITE_REPLAY=".runs/fill-http.json;.runs/postblind3-http.json;.runs/preblind-http.json" \
 *        NODE_OPTIONS=--max-old-space-size=8000 npx tsx scripts/stress-build.ts
 * Output: data/stress/base.json, data/stress/stress-set.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc } from '../src/core/doc';
import { Http } from '../src/core/http';
import { parseReference } from '../src/core/parse';
import { pdfToLines } from '../src/core/pdf';
import { contentTokens, fold } from '../src/core/text';
import type { ParsedRef, RefResult } from '../src/core/types';
import { verifyReference } from '../src/core/verify';
import { makeCache, replayMisses, replayRef } from './node-cache';

const root = fileURLToPath(new URL('../../data/', import.meta.url));
const outDir = `${root}stress/`;
mkdirSync(outDir, { recursive: true });
const PER_PAPER = Number(process.env.STRESS_PER_PAPER ?? 7);

/* ------------------------------------------------ seeded RNG ------------------------------------------------ */
let seed = 20261122;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const shuffle = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

interface Base {
  id: string;
  paper: string;
  raw: string;
  title: string;
  year: number;
  venue?: string;
  authors: { family: string; given?: string }[];
  etAl: boolean;
  dois: string[];
  arxivIds: string[];
  record: { title: string; authors: string[]; years: number[]; venue?: string; doi?: string; arxivId?: string };
}

/* ------------------------------------------------ stage 1 ------------------------------------------------ */
async function buildBase(): Promise<Base[]> {
  if (existsSync(`${outDir}base.json`) && !process.env.STRESS_REBUILD) return JSON.parse(readFileSync(`${outDir}base.json`, 'utf8'));
  if (!process.env.VERACITE_REPLAY) throw new Error('stage 1 must run under VERACITE_REPLAY (offline)');
  const cache = makeCache('');
  const http = new Http({ cache, maxRetries: 0 });
  const pool: Base[] = [];
  let seq = 0;
  for (const set of ['blind', 'blind2', 'blind3']) {
    const frozen = JSON.parse(readFileSync(`${root}${set}/results.json`, 'utf8'));
    for (const p of frozen.papers) {
      const pdf = `${root}pdfs/${set}/${p.file}`;
      if (!existsSync(pdf)) continue;
      const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(pdf)));
      const doc = buildDoc(lines, pageWidths);
      const res: RefResult[] = [];
      const ids: number[] = [];
      let next = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (next < doc.references.length) {
            const i = next++;
            ids[i] = seq++;
            res[i] = await replayRef.run(ids[i], () => verifyReference(doc.references[i], { http }, i));
          }
        }),
      );
      const ok: Base[] = [];
      res.forEach((r, i) => {
        const q = r.parsed;
        const st = (f: string) => r.checks.find((c) => c.field === f)?.status;
        if (r.verdict !== 'verified' || replayMisses.has(ids[i]) || !r.match) return;
        if (st('title') !== 'match' || st('authors') !== 'match' || st('year') !== 'match') return;
        if (!q.title || q.title.length < 20 || !q.raw.includes(q.title) || !q.year || !q.raw.includes(String(q.year))) return;
        if (!q.authors.length || q.kind !== 'article') return;
        ok.push({
          id: `${set}:${p.file}:${i}`,
          paper: `${set}:${p.file}`,
          raw: q.raw,
          title: q.title,
          year: q.year,
          venue: q.venue,
          authors: q.authors,
          etAl: q.etAl,
          dois: q.dois,
          arxivIds: q.arxivIds,
          record: { title: r.match.title, authors: r.match.authors.map((a) => a.family), years: r.match.years, venue: r.match.venue, doi: r.match.doi, arxivId: r.match.arxivId },
        });
      });
      pool.push(...shuffle(ok).slice(0, PER_PAPER));
      console.log(`${set}/${p.file}: ${res.length} refs, ${ok.length} clean verified, pool ${pool.length}`);
    }
  }
  writeFileSync(`${outDir}base.json`, JSON.stringify(pool, null, 1));
  return pool;
}

/* ------------------------------------------------ stage 2 ------------------------------------------------ */
export type ItemType =
  | 'control'
  | 'benign_no_id' // identifiers and URLs removed: forces the search path
  | 'benign_et_al' // authors after the first replaced by "et al."
  | 'benign_case' // title lower-cased, quotes dropped
  | 'err_doi_digits' // DOI or arXiv ID with altered digits
  | 'err_doi_swap' // another real work's DOI
  | 'err_author_first' // first author's family name replaced
  | 'err_author_other' // one later author's family name replaced
  | 'err_author_drop' // all authors after the first removed, no "et al."
  | 'err_year' // year shifted by 2-4
  | 'err_title_word' // one content word of the title replaced
  | 'err_venue' // venue replaced by another real venue
  | 'err_fabricated'; // title replaced by a plausible invented one, identifiers removed

export interface Item {
  id: string;
  base: string;
  type: ItemType;
  truth: 'correct' | 'error';
  field?: 'identifier' | 'authors' | 'year' | 'title' | 'venue' | 'existence';
  raw: string;
  note?: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ID_RE = /\s*(?:(?:doi|DOI)\s*:?\s*)?(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/[^\s,;]+|\s*(?:arXiv\s*:?\s*|https?:\/\/arxiv\.org\/abs\/)\d{4}\.\d{4,5}(?:v\d+)?(?:\s*\[[\w.-]+\])?|\s*https?:\/\/\S+/g;
const tidy = (s: string) => s.replace(/\s+([,.;])/g, '$1').replace(/([,;])\s*([,;.])/g, '$2').replace(/\s{2,}/g, ' ').trim();

/** the span of the author list in the raw string: from the first author's family name to the end of the last one's name */
function authorSpan(b: Base): { start: number; firstEnd: number; lastEnd: number } | null {
  const tAt = b.raw.indexOf(b.title);
  const region = b.raw.slice(0, tAt);
  const f = b.authors[0].family;
  const l = b.authors[b.authors.length - 1].family;
  const fAt = region.search(new RegExp(`(?<![\\p{L}])${esc(f)}(?![\\p{L}])`, 'u'));
  if (fAt < 0) return null;
  // given name before ("J. Smith") or initials after ("Smith, J." / "Smith J")
  let firstEnd = fAt + f.length;
  const after = region.slice(firstEnd).match(/^(?:,?\s*(?:[A-Z][a-z]?\.\s*-?\s*)+|\s+[A-Z]{1,3}(?=[,.\s]))/u);
  if (after && !/^\s*[A-Z][a-z]+\s/.test(region.slice(firstEnd))) firstEnd += after[0].replace(/\s+$/, '').length;
  let lAt = -1;
  for (const m of region.matchAll(new RegExp(`(?<![\\p{L}])${esc(l)}(?![\\p{L}])`, 'gu'))) lAt = m.index!;
  if (lAt <= fAt) return null;
  let lastEnd = lAt + l.length;
  const after2 = region.slice(lastEnd).match(/^(?:,?\s*(?:[A-Z][a-z]?\.\s*-?\s*)+|\s+[A-Z]{1,3}(?=[,.\s]))/u);
  if (after2) lastEnd += after2[0].replace(/\s+$/, '').length;
  let start = fAt;
  // a given name before the first family name ("Jane Smith", "J. Smith")
  const before = region.slice(0, fAt).match(/(?:[\p{Lu}][\p{L}.'-]*\s+){1,3}$/u);
  if (before && !/^\s*\[/.test(before[0])) start = fAt - before[0].length;
  return { start, firstEnd, lastEnd };
}

const changed = (q: ParsedRef, b: Base) => ({
  title: (q.title ?? '') !== b.title,
  year: q.year !== b.year,
  authors: q.authors.length !== b.authors.length || q.authors.some((a, i) => a.family !== b.authors[i]?.family),
});

function inject(b: Base, type: ItemType, pool: Base[]): { raw: string; note?: string } | null {
  const r = b.raw;
  const others = pool.filter((o) => o.paper !== b.paper);
  switch (type) {
    case 'control':
      return { raw: r };
    case 'benign_no_id': {
      if (!b.dois.length && !b.arxivIds.length && !/https?:\/\//.test(r)) return null;
      const raw = tidy(r.replace(ID_RE, ''));
      const q = parseReference(raw);
      if (q.dois.length || q.arxivIds.length) return null;
      const c = changed(q, b);
      return c.title || c.year || c.authors ? null : { raw };
    }
    case 'benign_et_al':
    case 'err_author_drop': {
      if (b.authors.length < 3 || b.etAl) return null;
      const s = authorSpan(b);
      if (!s) return null;
      const raw = r.slice(0, s.firstEnd) + (type === 'benign_et_al' ? ' et al.' : '') + r.slice(s.lastEnd);
      const q = parseReference(raw);
      if (q.authors.length !== 1 || q.authors[0].family !== b.authors[0].family || (q.title ?? '') !== b.title || q.year !== b.year) return null;
      if (type === 'benign_et_al' && !q.etAl) return null;
      return { raw: tidy(raw), note: `${b.authors.length} → 1 author${type === 'benign_et_al' ? ' + et al.' : ''}` };
    }
    case 'benign_case': {
      const t = b.title.toLowerCase();
      if (t === b.title) return null;
      const raw = r.replace(b.title, t);
      const q = parseReference(raw);
      if (fold(q.title ?? '') !== fold(b.title) || changed(q, b).authors || q.year !== b.year) return null;
      return { raw };
    }
    case 'err_doi_digits': {
      const id = b.dois[0] ?? b.arxivIds[0];
      if (!id || !r.includes(id)) return null;
      // change the last two digits of the identifier's final digit run
      const m = [...id.matchAll(/\d+/g)].pop();
      if (!m || m[0].length < 2) return null;
      const d = m[0];
      let nd = d;
      for (let k = 0; k < 10 && nd === d; k++) nd = d.slice(0, -2) + String(Math.floor(rnd() * 100)).padStart(2, '0');
      const nid = id.slice(0, m.index!) + nd + id.slice(m.index! + d.length);
      const raw = r.split(id).join(nid);
      const q = parseReference(raw);
      if (![...q.dois, ...q.arxivIds].some((x) => x.toLowerCase() === nid.toLowerCase()) || changed(q, b).title) return null;
      return { raw, note: `${id} → ${nid}` };
    }
    case 'err_doi_swap': {
      const id = b.dois[0];
      if (!id || !r.includes(id)) return null;
      const o = pick(others.filter((x) => x.dois.length && x.record.doi && fold(x.record.title) !== fold(b.record.title)));
      if (!o) return null;
      const raw = r.split(id).join(o.dois[0]);
      const q = parseReference(raw);
      if (!q.dois.some((x) => x.toLowerCase() === o.dois[0].toLowerCase()) || changed(q, b).title) return null;
      return { raw, note: `${id} → ${o.dois[0]} (${o.record.title.slice(0, 60)})` };
    }
    case 'err_author_first':
    case 'err_author_other': {
      if (type === 'err_author_other' && b.authors.length < 2) return null;
      const k = type === 'err_author_first' ? 0 : 1 + Math.floor(rnd() * (b.authors.length - 1));
      const fam = b.authors[k].family;
      if (fam.length < 3) return null;
      const tAt = r.indexOf(b.title);
      const re = new RegExp(`(?<![\\p{L}])${esc(fam)}(?![\\p{L}])`, 'u');
      const at = r.slice(0, tAt).search(re);
      if (at < 0) return null;
      const recFams = new Set(b.record.authors.map((x) => fold(x)));
      const cands = others.flatMap((o) => o.authors.map((a) => a.family)).filter((f) => f.length >= 4 && /^[\p{Lu}][\p{Ll}]+$/u.test(f) && !recFams.has(fold(f)) && fold(f) !== fold(fam));
      const nf = pick(cands);
      if (!nf) return null;
      const raw = r.slice(0, at) + nf + r.slice(at + fam.length);
      const q = parseReference(raw);
      if (q.authors[k]?.family !== nf || q.authors.length !== b.authors.length || (q.title ?? '') !== b.title) return null;
      return { raw, note: `author ${k + 1}/${b.authors.length}: ${fam} → ${nf}` };
    }
    case 'err_year': {
      const occ = r.match(new RegExp(`(?<!\\d)${b.year}(?!\\d)`, 'g'))?.length ?? 0;
      if (occ !== 1) return null;
      const deltas = [-4, -3, -2, 2, 3, 4].filter((d) => b.year + d <= 2026);
      const ny = b.year + pick(deltas);
      const raw = r.replace(new RegExp(`(?<!\\d)${b.year}(?!\\d)`), String(ny));
      const q = parseReference(raw);
      if (q.year !== ny || changed(q, b).title || changed(q, b).authors) return null;
      return { raw, note: `${b.year} → ${ny}` };
    }
    case 'err_title_word': {
      const words = b.title.match(/[\p{L}]{5,}/gu)?.filter((w, i) => i > 0 && /^[\p{Ll}\p{Lu}][\p{Ll}]+$/u.test(w)) ?? [];
      if (!words.length) return null;
      const w = pick(words);
      const have = new Set(contentTokens(b.title + ' ' + b.record.title));
      const vocab = others.flatMap((o) => o.title.match(/\b[a-z]{5,12}\b/g) ?? []).filter((x) => !have.has(x) && !/^(?:using|based|towards|through|between|within|without|their|which|these|those|about)$/.test(x));
      let nw = pick(vocab);
      if (!nw) return null;
      if (/^\p{Lu}/u.test(w)) nw = nw[0].toUpperCase() + nw.slice(1);
      const nt = b.title.replace(new RegExp(`(?<![\\p{L}])${esc(w)}(?![\\p{L}])`, 'u'), nw);
      const raw = r.replace(b.title, nt);
      const q = parseReference(raw);
      if ((q.title ?? '') !== nt || changed(q, b).authors || q.year !== b.year) return null;
      return { raw, note: `“${w}” → “${nw}”` };
    }
    case 'err_venue': {
      if (!b.venue || b.venue.length < 4 || !r.includes(b.venue) || !/[a-z]{3}/i.test(b.venue)) return null;
      const bt = new Set(contentTokens(b.venue + ' ' + (b.record.venue ?? '')));
      const o = pick(others.filter((x) => x.venue && x.venue.length >= 4 && /[a-z]{4}/.test(x.venue) && !/arxiv|preprint|corr/i.test(x.venue) && !contentTokens(x.venue).some((t) => bt.has(t))));
      if (!o) return null;
      const raw = r.replace(b.venue, o.venue!);
      const q = parseReference(raw);
      const c = changed(q, b);
      if (c.title || c.authors || q.year !== b.year || !q.venue || !q.venue.includes(o.venue!.slice(0, 8))) return null;
      return { raw, note: `“${b.venue}” → “${o.venue}”` };
    }
    case 'err_fabricated': {
      // a plausible title from other references' words: adjective-ish lead + nouns, same length class
      const n = Math.max(5, Math.min(11, b.title.split(/\s+/).length));
      const vocab = shuffle(others.flatMap((o) => o.title.match(/\b[a-z]{4,12}\b/g) ?? []).filter((x) => !/^(?:with|from|that|this|into|over|their|using|based|which)$/.test(x)));
      const ws = [...new Set(vocab)].slice(0, n - 2);
      if (ws.length < n - 2) return null;
      const glue = pick(['for', 'in', 'of', 'via', 'under']);
      const cut = Math.max(2, Math.floor((n - 2) / 2));
      let nt = [...ws.slice(0, cut), glue, ...ws.slice(cut)].join(' ');
      nt = nt[0].toUpperCase() + nt.slice(1);
      let raw = r.replace(b.title, nt);
      raw = tidy(raw.replace(ID_RE, ''));
      const q = parseReference(raw);
      if ((q.title ?? '') !== nt || q.dois.length || q.arxivIds.length || changed(q, b).authors) return null;
      return { raw, note: `title → “${nt}”` };
    }
  }
}

const FIELD: Partial<Record<ItemType, Item['field']>> = {
  err_doi_digits: 'identifier',
  err_doi_swap: 'identifier',
  err_author_first: 'authors',
  err_author_other: 'authors',
  err_author_drop: 'authors',
  err_year: 'year',
  err_title_word: 'title',
  err_venue: 'venue',
  err_fabricated: 'existence',
};
const ERR_TYPES = Object.keys(FIELD) as ItemType[];
const BENIGN: ItemType[] = ['benign_no_id', 'benign_et_al', 'benign_case'];

const base = await buildBase();
console.log(`base pool: ${base.length} references from ${new Set(base.map((b) => b.paper)).size} papers`);
const items: Item[] = [];
const errCount = new Map<ItemType, number>(ERR_TYPES.map((t) => [t, 0]));
for (const b of base) {
  items.push({ id: `${b.id}#control`, base: b.id, type: 'control', truth: 'correct', raw: b.raw });
  let benign = 0;
  for (const t of shuffle(BENIGN)) {
    if (benign >= 2) break;
    const x = inject(b, t, base);
    if (x) {
      items.push({ id: `${b.id}#${t}`, base: b.id, type: t, truth: 'correct', raw: x.raw, note: x.note });
      benign++;
    }
  }
  // three errors per base, least-used types first so the counts stay balanced
  let errs = 0;
  for (const t of [...ERR_TYPES].sort((a, c) => errCount.get(a)! - errCount.get(c)! || rnd() - 0.5)) {
    if (errs >= 3) break;
    const x = inject(b, t, base);
    if (!x) continue;
    items.push({ id: `${b.id}#${t}`, base: b.id, type: t, truth: 'error', field: FIELD[t], raw: x.raw, note: x.note });
    errCount.set(t, errCount.get(t)! + 1);
    errs++;
  }
}
const byType = new Map<string, number>();
for (const it of items) byType.set(it.type, (byType.get(it.type) ?? 0) + 1);
console.log([...byType].map(([t, n]) => `${t} ${n}`).join(', '));
writeFileSync(`${outDir}stress-set.json`, JSON.stringify({ seed: 20261122, built: new Date().toISOString(), bases: base.length, items }, null, 1));
process.exit(0);
