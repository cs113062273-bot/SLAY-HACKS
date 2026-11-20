/**
 * Document model: from positioned text lines (PDF) or plain text to
 * body sentences, reference entries and citation contexts (citances).
 */
import { cleanRefString, parseReference } from './parse';
import { fold, foldName } from './text';
import type { ParsedRef } from './types';

export interface Line {
  text: string;
  page: number;
  x: number;
  y: number; // top-down
  w: number;
  size: number;
  bold?: boolean;
  col?: number;
}

export interface Citance {
  id: number;
  /** sentence containing the citation, with markers intact */
  sentence: string;
  /** the claim with citation markers removed (normalized for verification) */
  claim: string;
  marker: string;
  refIndices: number[];
  /** index into Doc.sentences */
  sentenceIndex: number;
  /** 'mention' = the marker only names or exemplifies the cited work (no attributable claim) */
  kind: 'claim' | 'mention';
}

export interface Doc {
  title?: string;
  sentences: string[];
  references: ParsedRef[];
  rawReferences: string[];
  citances: Citance[];
  style: 'numeric' | 'author-year' | 'unknown';
  stats: { pages: number; words: number };
}

/* ------------------------------ layout ------------------------------ */

/** Order lines in reading order, handling two-column pages. */
export function orderLines(lines: Line[], pageWidths: Map<number, number>): Line[] {
  const out: Line[] = [];
  const pages = [...new Set(lines.map((l) => l.page))].sort((a, b) => a - b);
  for (const p of pages) {
    const L = lines.filter((l) => l.page === p);
    const W = pageWidths.get(p) ?? Math.max(...L.map((l) => l.x + l.w));
    const mid = W / 2;
    const narrow = L.filter((l) => l.w < W * 0.47);
    const right = narrow.filter((l) => l.x > mid - W * 0.02);
    const twoCol = narrow.length > L.length * 0.6 && right.length > L.length * 0.2;
    if (!twoCol) {
      out.push(...L.sort((a, b) => a.y - b.y || a.x - b.x).map((l) => ({ ...l, col: 0 })));
      continue;
    }
    // full-width blocks (title, abstract spanning both columns) split the page into bands
    const full = L.filter((l) => l.w >= W * 0.55).sort((a, b) => a.y - b.y);
    const bands: [number, number][] = [];
    let start = -Infinity;
    for (const f of full) {
      bands.push([start, f.y]);
      start = f.y;
    }
    bands.push([start, Infinity]);
    const used = new Set<Line>();
    for (const [y0, y1] of bands) {
      const inBand = L.filter((l) => l.y > y0 && l.y < y1 && l.w < W * 0.55);
      const left = inBand.filter((l) => l.x < mid - W * 0.02).sort((a, b) => a.y - b.y);
      const rightC = inBand.filter((l) => l.x >= mid - W * 0.02).sort((a, b) => a.y - b.y);
      const fl = full.find((f) => f.y === y1);
      for (const l of left) out.push({ ...l, col: 0 }), used.add(l);
      for (const l of rightC) out.push({ ...l, col: 1 }), used.add(l);
      if (fl && !used.has(fl)) out.push({ ...fl, col: 0 }), used.add(fl);
    }
  }
  return out;
}

/** A superscript reference label set as its own line ("2" beside "C. Monroe, …", AIP style) belongs to that line. */
function attachLabels(lines: Line[]): Line[] {
  const drop = new Set<Line>();
  const out = lines.map((l) => ({ ...l }));
  for (const lab of out) {
    if (!/^\s*\d{1,3}\s*$/.test(lab.text)) continue;
    const next = out.find((m) => m !== lab && m.page === lab.page && !drop.has(m) && Math.abs(m.y - lab.y) < lab.size * 0.8 && m.x > lab.x && m.x - (lab.x + lab.w) < lab.size * 1.5 && /^\p{Lu}/u.test(m.text));
    if (!next) continue;
    next.text = `${lab.text.trim()}${next.text}`;
    next.x = lab.x;
    drop.add(lab);
  }
  return out.filter((l) => !drop.has(l));
}

/** Drop running headers/footers and page numbers (text repeated on many pages at the same y). */
function dropFurniture(lines: Line[], nPages: number): Line[] {
  if (nPages < 3) return lines.filter((l) => !/^\s*\d{1,3}\s*$/.test(l.text));
  const key = (l: Line) => fold(l.text).replace(/\d+/g, '#');
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1);
  return lines.filter((l) => {
    if (/^\s*\d{1,3}\s*$/.test(l.text)) return false;
    const k = key(l);
    if (!/[a-z]{3}/.test(k)) return true; // never drop on repetition alone unless it has words ("2006." ≠ page number)
    const c = counts.get(k) ?? 0;
    return !(c >= Math.max(3, nPages * 0.5) && l.text.length < 120);
  });
}

/* ------------------------------ references section ------------------------------ */

const REF_HEAD = /^(?:[0-9IVX]+\.?|[A-Z]\.)?\s*(references|bibliography|works cited|literature cited|reference list|references and notes|cited literature)\s*:?\s*$/i;
const END_HEAD = /^(?:[A-Z]|[0-9]{1,2}|[IVX]+)?(?:\.\d+)*\.?\s*(appendix|appendices|supplementary|supplemental|acknowledg(?:e)?ments?|neurips paper checklist|checklist|author contributions|funding|conflicts? of interest|ethics statement|broader impact|limitations|declaration|data availability|code availability|biograph)/i;

export function findReferenceRange(lines: Line[]): [number, number] | null {
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (REF_HEAD.test(lines[i].text.trim())) {
      start = i;
      break;
    }
  }
  let first = start + 1;
  if (start < 0) {
    // no heading (REVTeX, AIP and some APS styles omit it): a numbered list that runs to the back of the paper
    const h = findHeadinglessStart(lines);
    if (h < 0) return null;
    start = h - 1;
    first = h;
  }
  const refSize = median(lines.slice(start + 1, start + 40).map((l) => l.size));
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].text.trim();
    // captions and ALL-CAPS appendix headings (ICLR style: "A FURTHER DETAILS ON …") end the list
    if (/^(?:Table|Figure|Fig\.|Algorithm)\s+[A-Z]?\d+[:.]/.test(t) || /^(?:[A-Z]|\d{1,2})(?:\.\d+)*\.?\s+[A-Z][A-Z0-9 ,:'’()\-]{6,}$/.test(t)) {
      end = i;
      break;
    }
    const heading = t.length < 90 && (lines[i].size > refSize * 1.12 || lines[i].bold) && !/^\[?\d+[\].]/.test(t);
    if ((heading && (END_HEAD.test(t) || /appendi|supplementa|checklist/i.test(t) || /^(?:[A-Z]|[0-9]{1,2})(?:\.\d+)*\.?\s+\p{Lu}/u.test(t))) || (END_HEAD.test(t) && t.length < 60 && /^(?:[A-Z]\.?\s|[0-9]+\.?\s)?\p{Lu}/u.test(t) && !/[.,]\s*$/.test(t))) {
      end = i;
      break;
    }
  }
  return [first, end];
}

/** Labels of numbered reference lists: "[1]", "1. ", and AIP's label glued to the first initial ("24P. Kunert"). */
const LABEL_RES = [/^\s*\[(\d{1,4})\]/, /^\s*(\d{1,3})\.\s/, /^\s*(\d{1,3}) ?(?=\p{Lu}\.)/u];

function findHeadinglessStart(lines: Line[]): number {
  for (const re of LABEL_RES) {
    for (let i = lines.length - 1; i >= lines.length * 0.3; i--) {
      const m = lines[i].text.match(re);
      if (!m || m[1] !== '1') continue;
      let expect = 1;
      let hits = 1;
      let last = i;
      for (let j = i + 1; j < lines.length; j++) {
        const n = Number(lines[j].text.match(re)?.[1] ?? NaN);
        if (n > expect && n <= expect + 3) {
          expect = n;
          hits++;
          last = j;
        }
      }
      // a reference list, not an enumerated list in the text: several entries, most labels in sequence, years inside
      const span = lines.slice(i, last + 1);
      const years = span.filter((l) => /\b(?:1[89]\d\d|20[0-3]\d)\b/.test(l.text)).length;
      if (hits >= 5 && hits >= expect * 0.7 && years >= hits * 0.5) return i;
    }
  }
  return -1;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Split reference-section lines into entries using labels, hanging indents or vertical gaps. */
export function splitEntries(lines: Line[]): string[] {
  if (!lines.length) return [];
  const numbered = lines.filter((l) => /^\s*(?:\[\d{1,4}\]|\d{1,4}\.\s|\(\d{1,4}\)\s|\d{1,3} ?(?=\p{Lu}\.))/u.test(l.text)).length;
  const entries: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) entries.push(cur.trim());
    cur = '';
  };
  const join = (a: string, b: string) => (a.endsWith('-') && /^\p{Ll}/u.test(b) ? a.slice(0, -1) + b : a + (a ? ' ' : '') + b);

  if (numbered >= Math.max(3, lines.length * 0.15)) {
    // dominant label style, and labels must be sequential ("2024. Association…" is not entry 2024)
    const styles: [RegExp, number][] = [
      [/^\s*\[(\d{1,4})\]/, 0],
      [/^\s*(\d{1,4})\.\s/, 0],
      [/^\s*\((\d{1,4})\)\s/, 0],
      [/^\s*(\d{1,3}) ?(?=\p{Lu}\.)/u, 0],
    ];
    for (const s of styles) s[1] = lines.filter((l) => s[0].test(l.text)).length;
    const re = styles.sort((a, b) => b[1] - a[1])[0][0];
    let expect = 0;
    const glued = re.flags.includes('u'); // AIP: the label touches the first initial, so it must be removed
    for (const l of lines) {
      const m = l.text.match(re);
      const n = m ? parseInt(m[1], 10) : -1;
      let text = l.text;
      if (m && (expect === 0 || n === expect + 1 || (n > expect && n <= expect + 3))) {
        if (cur) push();
        expect = n;
        if (glued) text = text.replace(re, '');
      }
      cur = join(cur, text.trim());
    }
    push();
    return entries;
  }
  // per column margins
  const byCol = new Map<string, Line[]>();
  for (const l of lines) {
    const k = `${l.page}:${l.col ?? 0}`;
    byCol.set(k, [...(byCol.get(k) ?? []), l]);
  }
  const margin = new Map<string, number>();
  for (const [k, ls] of byCol) margin.set(k, Math.min(...ls.map((l) => l.x)));
  const indented = lines.filter((l) => l.x - margin.get(`${l.page}:${l.col ?? 0}`)! > l.size * 0.6).length;
  const hanging = indented > lines.length * 0.2;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) if (lines[i].page === lines[i - 1].page && lines[i].col === lines[i - 1].col) gaps.push(lines[i].y - lines[i - 1].y);
  const g = median(gaps);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const prev = lines[i - 1];
    const m = margin.get(`${l.page}:${l.col ?? 0}`)!;
    let starts = false;
    if (hanging) starts = l.x - m <= l.size * 0.6;
    else if (prev && prev.page === l.page && prev.col === l.col) starts = l.y - prev.y > g * 1.25;
    else starts = !!prev && /[.]\s*$/.test(prev.text) && /^\p{Lu}[\p{L}'-]+,?\s/u.test(l.text);
    if (starts && cur) push();
    cur = join(cur, l.text.trim());
  }
  push();
  // merge fragments that are too short to be a reference
  const merged: string[] = [];
  for (const e of entries) {
    if (merged.length && (e.length < 25 || !/[a-z]{3}/i.test(e))) merged[merged.length - 1] += ' ' + e;
    else merged.push(e);
  }
  return merged;
}

/** Split a plain-text reference list (pasted) into entries. */
export function splitPlainReferences(text: string): string[] {
  const t = text.replace(/\r/g, '');
  const blocks = t.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length > 1 && blocks.every((b) => b.length < 1200)) return blocks.map((b) => b.replace(/\s*\n\s*/g, ' '));
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  const numbered = lines.filter((l) => /^(?:\[\d+\]|\d+\.\s)/.test(l)).length > lines.length * 0.3;
  for (const l of lines) {
    const start = numbered ? /^(?:\[\d+\]|\d+\.\s)/.test(l) : /[.]\s*$/.test(cur) && /^\p{Lu}[\p{L}'-]+,?\s/u.test(l);
    if (start && cur) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? (cur.endsWith('-') ? cur.slice(0, -1) + l : cur + ' ' + l) : l;
  }
  if (cur) out.push(cur);
  return out;
}

/* ------------------------------ sentences & citations ------------------------------ */

const ABBR = /\b(?:et al|e\.g|i\.e|cf|Fig|Figs|Eq|Eqs|Sec|Tab|vs|approx|resp|Ref|Refs|No|Vol|al|Dr|Prof|St|Inc|Ltd|ca|viz|Ch|App)\.$/i;

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[.!?](?:["”’)\]]*)\s+(?=["“(\[]?\p{Lu})/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const candidate = text.slice(last, end).trim();
    const head = text.slice(Math.max(0, m.index - 12), m.index + 1);
    if (ABBR.test(head) || /\b\p{Lu}\.$/u.test(head)) continue;
    out.push(candidate);
    last = end;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push(rest);
  return out.filter((s) => s.length > 2);
}

function expandNumeric(inner: string): number[] {
  const out: number[] = [];
  for (const part of inner.split(/[,;]/)) {
    const r = part.trim().match(/^(\d{1,4})\s*[-–]\s*(\d{1,4})$/);
    if (r) {
      const a = +r[1];
      const b = +r[2];
      if (b >= a && b - a < 50) for (let i = a; i <= b; i++) out.push(i);
    } else if (/^\d{1,4}$/.test(part.trim())) out.push(+part.trim());
  }
  return out;
}

interface AYKey {
  fam: string;
  year: string;
  idx: number;
}

function authorYearKeys(refs: ParsedRef[]): AYKey[] {
  const keys: AYKey[] = [];
  refs.forEach((r, idx) => {
    const fam = r.authors[0]?.family;
    const y = r.raw.match(/\b(1[89]\d\d|20[0-3]\d)([a-z])?\b/);
    if (!fam || !r.year) return;
    const suffix = r.raw.match(new RegExp(`\\b${r.year}([a-z])\\b`))?.[1] ?? '';
    keys.push({ fam: foldName(fam), year: `${r.year}${suffix}`, idx });
    void y;
  });
  return keys;
}

export function findCitations(sentences: string[], refs: ParsedRef[]): { citances: Citance[]; style: Doc['style'] } {
  const citances: Citance[] = [];
  const labelToIdx = new Map<string, number>();
  refs.forEach((r, i) => {
    if (r.label) labelToIdx.set(r.label, i);
  });
  const numericLabels = refs.filter((r) => r.label && /^\d+$/.test(r.label)).length > refs.length * 0.5;
  const ay = authorYearKeys(refs);
  const lookupAY = (surname: string, year: string): number | undefined => {
    const f = foldName(surname);
    const exact = ay.find((k) => k.year === year && k.fam === f);
    if (exact) return exact.idx;
    const loose = ay.find((k) => k.year.slice(0, 4) === year.slice(0, 4) && (k.fam === f || (f.length > 4 && (k.fam.startsWith(f) || f.startsWith(k.fam)))));
    return loose?.idx;
  };
  let id = 0;
  let nNum = 0;
  let nAY = 0;
  sentences.forEach((s, si) => {
    const found: { marker: string; idx: number[] }[] = [];
    if (numericLabels) {
      for (const m of s.matchAll(/\[(\d{1,4}(?:\s*[-–,;]\s*\d{1,4})*)\]/g)) {
        const nums = expandNumeric(m[1]);
        const idx = nums.map((n) => labelToIdx.get(String(n))).filter((x): x is number => x !== undefined);
        if (idx.length) {
          found.push({ marker: m[0], idx });
          nNum++;
        }
      }
    }
    if (!numericLabels || !found.length) {
      // parenthetical (Smith et al., 2020; Doe and Roe, 2019a), also bracketed [Plokhy, 2010; Snyder 2003]
      for (const m of s.matchAll(/[([]([^()[\]]{3,300}?\b(?:1[89]|20)\d\d[a-z]?)[)\]]/g)) {
        const idx: number[] = [];
        for (const part of m[1].split(/;/)) {
          const mm = part.match(/(\p{Lu}[\p{L}'’-]+(?:\s+(?:van|von|de|der|del)\s+\p{Lu}[\p{L}'’-]+)?)(?:\s+(?:et al\.?|and|&)\s*(?:\p{Lu}[\p{L}'’-]+)?)?,?\s*((?:1[89]|20)\d\d[a-z]?)/u);
          if (mm) {
            const i = lookupAY(mm[1], mm[2]);
            if (i !== undefined) idx.push(i);
            // "Smith, 2019a, 2020" multiple years
            for (const extra of part.slice((mm.index ?? 0) + mm[0].length).matchAll(/,\s*((?:1[89]|20)\d\d[a-z]?)/g)) {
              const j = lookupAY(mm[1], extra[1]);
              if (j !== undefined) idx.push(j);
            }
          }
        }
        if (idx.length) {
          found.push({ marker: m[0], idx });
          nAY++;
        }
      }
      // narrative: Smith et al. (2020), Smith and Doe (2019)
      for (const m of s.matchAll(/(\p{Lu}[\p{L}'’-]+)(?:\s+(?:et al\.?|and\s+\p{Lu}[\p{L}'’-]+|&\s+\p{Lu}[\p{L}'’-]+))?\s*\(((?:1[89]|20)\d\d[a-z]?)\)/gu)) {
        const i = lookupAY(m[1], m[2]);
        if (i !== undefined) {
          found.push({ marker: m[0], idx: [i] });
          nAY++;
        }
      }
    }
    for (const f of found) {
      const idx = [...new Set(f.idx)];
      citances.push({ id: id++, sentence: s, claim: normalizeClaim(s), marker: f.marker, refIndices: idx, sentenceIndex: si, kind: citeKind(s, f.marker, idx.map((i) => refs[i]?.title ?? '')) });
    }
  });
  return { citances, style: nNum > nAY ? 'numeric' : nAY ? 'author-year' : 'unknown' };
}

const MENTION_CUE = /(?:such as|e\.g\.,?|for example,?|see(?: also)?|cf\.|including|like|i\.e\.,?|namely|via|using|with|and|or)\s*$/i;

/** Does the marker merely name or exemplify the cited work (rather than attribute a claim to it)? */
export function citeKind(sentence: string, marker: string, titles: string[]): 'claim' | 'mention' {
  const k = sentence.indexOf(marker);
  if (k < 0) return 'claim';
  const before = sentence.slice(Math.max(0, k - 80), k).trim();
  const after = sentence.slice(k + marker.length, k + marker.length + 12);
  if (MENTION_CUE.test(before)) return 'mention';
  // words right before the marker appear in the cited title: "long short-term memory [13]", "Adam [20]"
  const prev = (before.match(/[\p{L}\d][\p{L}\d-]*/gu) ?? []).slice(-4).map((w) => w.toLowerCase().replace(/s$/, ''));
  for (const t of titles) {
    const tw = new Set((t.toLowerCase().match(/[\p{L}\d][\p{L}\d-]*/gu) ?? []).map((w) => w.replace(/s$/, '')));
    const hits = prev.filter((w) => w.length > 2 && tw.has(w)).length;
    if (hits >= 2 || (hits >= 1 && prev.length && tw.has(prev[prev.length - 1]) && /^[\s,;)]/.test(after))) return 'mention';
  }
  return 'claim';
}

/** Remove citation markers & reference noise so the sentence reads as a standalone claim. */
export function normalizeClaim(s: string): string {
  return s
    .replace(/<\|multi_cit\|>|<CITATION_MARKER>|<\/CITATION_MARKER>/g, ' ')
    .replace(/\[(\d{1,4}(?:\s*[-–,;]\s*\d{1,4})*)\]/g, ' ')
    .replace(/\(([^()]{3,300}?\b(?:1[89]|20)\d\d[a-z]?)\)/g, (m) => (/\p{Lu}[\p{L}'’-]+/u.test(m) ? ' ' : m))
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** natbib/biblatex back-references: "… 2020. 1, 2, 5" or "… 2020. Cited on page 3." */
function stripBackrefs(s: string): string {
  return s.replace(/\.\s+(?:\d{1,3}(?:\s*[,–-]\s*\d{1,3})*|(?:cited on pages?|p(?:p|ages?)?\.?)\s*[\d,\s–-]+\.?)\s*$/i, '.');
}

/** The last entry has nothing after it to end it, so appendix/figure text can leak in: cut an unusually
 *  long final entry at its first natural reference ending (year, page range, DOI or URL + period). */
function trimLastEntry(entries: string[]): string[] {
  if (entries.length < 3) return entries;
  const lens = entries.slice(0, -1).map((e) => e.length).sort((a, b) => a - b);
  const med = lens[Math.floor(lens.length / 2)];
  const last = entries[entries.length - 1];
  if (last.length < Math.max(med * 2.5, 400)) return entries;
  const m = last.match(/^[\s\S]{40,}?(?:\b(?:1[89]|20)\d\d[a-z]?\)?|\d+\s*[-–]\s*\d+|10\.\d{4,}\/\S+|https?:\/\/\S+)\.(?=\s|$)/);
  return m ? [...entries.slice(0, -1), m[0]] : entries;
}

/** Keep entries that look like references; stop after a run of non-reference text (appendix leakage). */
function keepReferenceLike(entries: string[]): string[] {
  const out: string[] = [];
  let bad = 0;
  for (const e of entries) {
    const looks = e.length > 15 && e.length < 1600 && (/\b(1[89]\d\d|20[0-3]\d)[a-z]?\b/.test(e) || /\b10\.\d{4,}\/|arxiv|https?:\/\//i.test(e)) && /\p{L}{3}/u.test(e);
    if (looks) {
      out.push(e);
      bad = 0;
    } else if (++bad >= 3) break;
  }
  return out;
}

/* ------------------------------ build ------------------------------ */

export function buildDoc(linesIn: Line[], pageWidths: Map<number, number>): Doc {
  const nPages = new Set(linesIn.map((l) => l.page)).size;
  const lines = orderLines(dropFurniture(attachLabels(linesIn), nPages), pageWidths);
  const range = findReferenceRange(lines);
  const bodyLines = range ? lines.slice(0, range[0] - 1) : lines;
  const refLines = range ? lines.slice(range[0], range[1]) : [];
  const rawReferences = trimLastEntry(keepReferenceLike(splitEntries(refLines).map(stripBackrefs).map(cleanRefString)));
  const references = rawReferences.map(parseReference);
  // body text: join lines, fix hyphenation
  let body = '';
  const bodySize = median(bodyLines.map((l) => l.size));
  for (const l of bodyLines) {
    if (l.size < bodySize * 0.9) continue; // footnotes, captions in small type (8–9 pt in a 10 pt body)
    const t0 = l.text.trim();
    // section headings end the current sentence and are not part of any claim
    if (t0.length < 90 && (l.size > bodySize * 1.12 || (l.bold && /^(?:\d+(?:\.\d+)*|[A-Z]|[IVX]+)\.?\s+\p{Lu}/u.test(t0))) && !/[.,;:]$/.test(t0)) {
      if (body && !/[.!?]$/.test(body)) body += '.';
      continue;
    }
    const t = l.text.trim();
    if (!t) continue;
    if (body.endsWith('-') && /^\p{Ll}/u.test(t)) body = body.slice(0, -1) + t;
    else body += (body ? ' ' : '') + t;
  }
  const sentences = splitSentences(body.replace(/\s+/g, ' '));
  const { citances, style } = findCitations(sentences, references);
  // the largest line on page 1, joined with the lines of the same size right below it (titles often wrap)
  const p1 = lines.filter((l) => l.page === 1);
  const top = [...p1].sort((a, b) => b.size - a.size)[0];
  let title = top?.text;
  if (top) {
    let last = top;
    for (const l of p1.filter((l) => l.y > top.y && Math.abs(l.size - top.size) < 0.6).sort((a, b) => a.y - b.y)) {
      if (l.y - last.y > top.size * 1.8 || title!.length > 250) break;
      title += ' ' + l.text;
      last = l;
    }
  }
  title = title?.replace(/[\s∗*†‡§¶]+$/u, '');
  return { title, sentences, references, rawReferences, citances, style, stats: { pages: nPages, words: body.split(/\s+/).length } };
}

/** Plain text input: either a full paper (with a References heading) or just a reference list. */
export function buildDocFromText(text: string): Doc {
  const t = text.replace(/\r/g, '');
  const m = [...t.matchAll(/^\s*(?:[0-9IVX]+\.?\s*)?(references|bibliography|works cited|literature cited|reference list)\s*:?\s*$/gim)].pop();
  let bodyText = '';
  let refText = t;
  if (m && m.index !== undefined) {
    bodyText = t.slice(0, m.index);
    refText = t.slice(m.index + m[0].length);
    const end = refText.search(/^\s*(?:[A-Z]|\d+)?\.?\s*(appendix|supplementary|acknowledg)/im);
    if (end > 0) refText = refText.slice(0, end);
  }
  const rawReferences = splitPlainReferences(refText).map(cleanRefString).filter((r) => r.length > 15);
  const references = rawReferences.map(parseReference);
  const sentences = bodyText ? splitSentences(bodyText.replace(/-\n(?=\p{Ll})/gu, '').replace(/\s+/g, ' ')) : [];
  const { citances, style } = findCitations(sentences, references);
  return { sentences, references, rawReferences, citances, style, stats: { pages: 0, words: bodyText.split(/\s+/).length } };
}
