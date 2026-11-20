/** Text normalization and fuzzy matching utilities (no dependencies, runs in browser and Node). */

const LIGATURES: Record<string, string> = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ı': 'i' };

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
const HOMOGLYPH: Record<string, string> = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', І: 'I', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', а: 'a', е: 'e', і: 'i', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', ԁ: 'd', ј: 'j' };
const HTML_ENT: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };

export function fold(s: string): string {
  return s
    .replace(/&(amp|apos|quot|lt|gt|nbsp);/gi, (_, e: string) => HTML_ENT[e.toLowerCase()])
    .replace(/\\(?:mathrm|text|textrm|textit|textbf|mathit|mathbf|mathcal|emph|rm|it|bf|sqrt|left|right)\b\s*|[{}$]/g, '') // LaTeX in titles: "${\mathrm{Latent}Out}$" → "LatentOut"
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

/** Similarity of two titles, robust to case, punctuation, subtitles and small typos. */
export function titleSim(a: string, b: string): number {
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
  return Math.max(r, sub, tokenJaccard(fa, fb) * 0.97);
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
