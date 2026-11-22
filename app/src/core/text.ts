/** Text normalization and fuzzy matching utilities (no dependencies, runs in browser and Node). */

const LIGATURES: Record<string, string> = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ı': 'i' };

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
const HOMOGLYPH: Record<string, string> = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', І: 'I', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', а: 'a', е: 'e', і: 'i', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', ԁ: 'd', ј: 'j' };
const HTML_ENT: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };

export function fold(s: string): string {
  return s
    .replace(/&(amp|apos|quot|lt|gt|nbsp);/gi, (_, e: string) => HTML_ENT[e.toLowerCase()])
    // Springer deposits inline math in Crossref titles as a whole LaTeX document preamble
    .replace(/\\documentclass[\s\S]*?(?:\\begin\{document\}|$)|\\end\{document\}/g, ' ')
    .replace(/\\(?:mathrm|text|textrm|textit|textbf|mathit|mathbf|mathcal|emph|rm|it|bf|sqrt|left|right)\b\s*|[{}$]/g, '') // LaTeX in titles: "${\mathrm{Latent}Out}$" → "LatentOut"
    // remaining LaTeX symbols (\rightarrow, \pm, \gamma, \bar) are punctuation-like, as their Unicode forms are;
    // sub/superscript markers join their operand ("D^0", "K_S^0" → "D0", "KS0") as PDF text does
    .replace(/\\[a-zA-Z]+\s*|\\[,;:!]/g, ' ')
    .replace(/[\^_]/g, '')
    .replace(/(\p{L})['’`](\p{L})/gu, '$1$2') // can't → cant, O'Brien → OBrien
    // Cyrillic look-alikes inside Latin words ("СERN" typed with a Cyrillic С)
    .replace(/[\p{Script=Latin}\p{Script=Cyrillic}]+/gu, (w) => (/\p{Script=Latin}/u.test(w) && /\p{Script=Cyrillic}/u.test(w) ? w.replace(/[АВСЕНІКМОРТХаеіорсухԁј]/g, (c) => HOMOGLYPH[c] ?? c) : w))
    .replace(/[ﬁﬂﬀﬃﬄßæœøłđı]/gi, (c) => LIGATURES[c.toLowerCase()] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ') // inline markup from Crossref (<i>, <sub>)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokens(s: string): string[] {
  const f = fold(s);
  return f ? f.split(' ') : [];
}

const STOP = new Set('a an the of for and in on to with by from at via as is are using towards toward its into or vs versus'.split(' '));
export function contentTokens(s: string): string[] {
  return tokens(s).filter((t) => !STOP.has(t) && t.length > 1);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 1 − normalized edit distance. */
export function ratio(a: string, b: string): number {
  if (!a && !b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

/**
 * Spell out acronyms of `a` that `b` writes in full: "QPOs of SGRs" against "Quasiperiodic Oscillations of Soft
 * Gamma-Ray Repeaters" → "Quasiperiodic Oscillations of Soft Gamma-Ray Repeaters". A word may supply the initials of
 * its own parts ("Quasiperiodic" → QP). Only all-capital acronyms (2–6 letters, optional plural s) that `b` lacks.
 */
export function expandAcronyms(a: string, b: string): string {
  const words = b.split(/[\s/]+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  const inB = new Set(words.map((w) => w.toLowerCase()));
  // an acronym already written inside a word of `b` ("Re2TAL" for "Re 2 TAL") is not spelled out there
  const bJoined = b.toLowerCase().replace(/[^a-z0-9]+/g, '');
  // can words[i..] spell ac[k..]? returns the number of words used, or 0
  const spell = (ac: string, k: number, i: number): number => {
    if (k === ac.length) return 0;
    const w = words[i];
    if (!w || w[0].toUpperCase() !== ac[k]) return -1;
    // the word supplies ac[k] and possibly the next letters as inner morphemes (at least 3 letters apart)
    let pos = 0;
    for (let m = k; m < ac.length; m++) {
      if (m > k) {
        pos = w.toUpperCase().indexOf(ac[m], pos + 3);
        if (pos < 0) break;
      }
      const rest = spell(ac, m + 1, i + 1);
      if (rest >= 0) return 1 + rest;
    }
    return -1;
  };
  return a.replace(/\b([A-Z]{2,6})(s?)\b/g, (m, ac: string) => {
    if (inB.has(m.toLowerCase()) || inB.has(ac.toLowerCase()) || bJoined.includes(ac.toLowerCase())) return m;
    for (let i = 0; i < words.length; i++) {
      const n = spell(ac, 0, i);
      if (n > 0 && n <= ac.length) return words.slice(i, i + n).join(' ');
    }
    return m;
  });
}

/** Similarity of two titles, robust to case, punctuation, subtitles, acronyms and small typos. */
export function titleSim(a: string, b: string): number {
  const base = titleSim0(a, b);
  if (base >= 0.97 || !/\b[A-Z]{2,6}s?\b/.test(a + ' ' + b)) return base;
  return Math.max(base, titleSim0(expandAcronyms(a, b), expandAcronyms(b, a)));
}

function titleSim0(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  const r = ratio(fa, fb);
  // subtitle tolerance: "X: Y" cited as "X" (or vice-versa)
  const short = fa.length < fb.length ? fa : fb;
  const long = fa.length < fb.length ? fb : fa;
  let sub = 0;
  if (short.length >= 12 && long.startsWith(short)) sub = 0.93;
  return Math.max(r, sub, tokenJaccard(fa, fb) * 0.97, containment(fa, fb));
}

/**
 * Same words in another order, one side carrying a few extra symbol tokens: "Solution of the matrix equation
 * AX+XB=C: Algorithm 432" vs "Algorithm 432 [C2]: Solution of the matrix equation AX + XB = C [F4]".
 */
function containment(fa: string, fb: string): number {
  const A = fa.split(' ');
  const B = fb.split(' ');
  const [S, L] = A.length <= B.length ? [A, B] : [B, A];
  if (S.length < 5) return 0;
  const Ls = new Set(L);
  if (!S.every((t) => Ls.has(t))) return 0;
  const Ss = new Set(S);
  const extra = L.filter((t) => !Ss.has(t));
  return extra.length <= 3 && extra.every((t) => t.length <= 3 || /\d/.test(t)) ? 0.9 : 0;
}

function tokenJaccard(fa: string, fb: string): number {
  const A = new Set(fa.split(' '));
  const B = new Set(fb.split(' '));
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Best fuzzy occurrence of `needle` inside `haystack` (both raw strings).
 * Returns similarity in [0,1] and the token span. Used to align a candidate's title onto the raw reference.
 */
export function fuzzyFind(needle: string, haystack: string): { score: number; start: number; end: number } {
  const n = tokens(needle);
  const h = tokens(haystack);
  if (!n.length || !h.length) return { score: 0, start: -1, end: -1 };
  const nj = n.join(' ');
  // An exact token span is the global maximum. Return its first occurrence, matching the fuzzy loop's tie rule.
  for (let i = 0; i + n.length <= h.length; i++) {
    if (n.every((t, j) => h[i + j] === t)) return { score: 1, start: i, end: i + n.length };
  }
  let best = { score: 0, start: -1, end: -1 };
  const minW = Math.max(1, n.length - 3);
  const maxW = n.length + 3;
  for (let i = 0; i < h.length; i++) {
    for (let w = minW; w <= maxW && i + w <= h.length; w++) {
      const seg = h.slice(i, i + w).join(' ');
      // quick reject by length
      if (Math.abs(seg.length - nj.length) > nj.length * 0.5) continue;
      const s = ratio(seg, nj);
      if (s > best.score) best = { score: s, start: i, end: i + w };
    }
  }
  return best;
}

/** Normalize a person surname for comparison. */
export function foldName(s: string): string {
  return fold(s).replace(/ /g, '');
}

export function nameSim(a: string, b: string): number {
  const fa = foldName(a);
  const fb = foldName(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  // handle mojibake/lost characters ("Gy?rgy" vs "Gyorgy", "Kr?ger" vs "Kruger")
  return ratio(fa, fb);
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
