import type { ParsedRef, Person, RefKind } from './types';
import { fold } from './text';

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/gi;
const ARXIV_RES = [
  /arxiv(?:\s*preprint)?(?:\s*,)?\s*(?:arxiv)?\s*[:\s]\s*(\d{4}\.\d{4,5})(v\d+)?/gi,
  /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/gi,
  /\babs\/(\d{4}\.\d{4,5})(v\d+)?/gi,
  /10\.48550\/arxiv\.(\d{4}\.\d{4,5})/gi,
  /arxiv[^0-9]{0,30}?(\d{4}\.\d{4,5})(v\d+)?/gi,
];
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

/** Abbreviations after which a period does not end a sentence. */
const ABBREV = new Set(
  'al eds ed vol vols no nos pp p proc conf int intl j trans assoc comput natl acad sci res rev lett phys chem biol med eng univ dept tech rep inc ltd co corp st jr sr vs etc fig figs ch sec ser symp workshop annu adv appl math stat mach learn ling ieee acm amer am soc lect notes jpn mol cell sep sept oct nov dec jan feb mar apr jun jul aug dr prof mr mrs ms n.d'.split(
    ' ',
  ),
);

const ENTITIES: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m)));
}

export function cleanRefString(s: string): string {
  return decodeEntities(s)
    .replace(/­/g, '') // soft hyphen
    .replace(/[‐‑‒–—−]/g, (c) => (c === '—' ? ' - ' : '-'))
    .replace(/([a-z])- ([a-z])/g, '$1$2') // de-hyphenate line breaks ("informa- tion")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.,;:)\]}>'"’”]+$/, '');
}

/** A DOI broken at a line end ("10.1534/genetics.116. 190041") continues with a digit-bearing chunk. */
const DOI_CONT_RE = /^\s([0-9a-z][\w.\-/()]*?\d[\w\-/()]*)(?=[.,;]?(?:\s|$))/i;

export function extractDois(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(DOI_RE)) {
    let d = stripTrailingPunct(m[1]);
    if (m[1].endsWith('.')) {
      const cont = s.slice((m.index ?? 0) + m[0].length).match(DOI_CONT_RE);
      if (cont && !/^(?:1[89]|20)\d\d$/.test(cont[1])) d = `${d}.${stripTrailingPunct(cont[1])}`;
    } else if (m[1].endsWith('-')) {
      // broken after a hyphen: "10.1186/1471- 2105-9-359"
      const cont = s.slice((m.index ?? 0) + m[0].length).match(DOI_CONT_RE);
      if (cont) d = `${d}${stripTrailingPunct(cont[1])}`;
    }
    // unbalanced trailing parenthesis
    if (d.endsWith(')') && !d.includes('(')) d = d.slice(0, -1);
    d = d.replace(/\.(?:pdf|html?)$/i, '');
    if (/^10\.48550\/arxiv/i.test(d)) continue; // arXiv DOI handled as arXiv ID
    out.push(d.toLowerCase());
  }
  const uniq = [...new Set(out)];
  // "10.1371/journal.pgen" (truncated at a line break) next to the full DOI: keep the longer one;
  // "10.1093/genetics/iyae011/7592060" (publisher URL path) next to the DOI: keep the shorter one
  return uniq.filter((d) => !uniq.some((o) => o !== d && ((o.startsWith(d) && /^[.\-_]/.test(o.slice(d.length))) || (d.startsWith(o) && d[o.length] === '/'))));
}

/** Other plausible readings of a DOI that did not resolve (line-break joins, URL path suffixes). */
export function doiAlternatives(doi: string, raw: string): string[] {
  const alts: string[] = [];
  const parts = doi.split('/');
  // publisher URL paths append numeric article ids: ".../genetics/iyae011/7592060"
  for (let k = parts.length - 1; k >= 3 && /^\d{4,}$/.test(parts[k]); k--) alts.push(parts.slice(0, k).join('/'));
  const lower = raw.toLowerCase();
  const at = lower.indexOf(doi);
  if (at >= 0) {
    const cont = raw.slice(at + doi.length).match(/^\.?\s([0-9a-z][\w.\-/()]*?\d[\w\-/()]*)(?=[.,;]?(?:\s|$))/i);
    if (cont) alts.push(`${doi}.${stripTrailingPunct(cont[1])}`.toLowerCase());
  }
  return [...new Set(alts)].filter((a) => a !== doi && /^10\.\d{4,9}\/./.test(a));
}

export function extractArxiv(s: string): string[] {
  const out: string[] = [];
  for (const re of ARXIV_RES) for (const m of s.matchAll(re)) out.push(m[1]);
  return [...new Set(out)];
}

function detectPlaceholders(s: string): string[] {
  const p: string[] = [];
  if (/\d{4}\.(?:X{2,}|x{3,}|\?{2,}|_{2,})/.test(s)) p.push('placeholder arXiv identifier');
  if (/\bfirst\s*name\b|\blast\s*name\b|\bfirstname\b|\blastname\b/i.test(s)) p.push('template author name');
  if (/to be (?:updated|added|filled|confirmed)|\bTBD\b|\bTODO\b|\bxxx+\b|\[citation needed\]|\?\?\?/i.test(s)) p.push('unfilled template text');
  if (/\b(?:author|authors)\s+(?:et al|name)\b/i.test(s)) p.push('generic author placeholder');
  if (/\bJohn Smith\b|\bJane Doe\b|\bJ\. Doe\b|\bA\. N\. Other\b/i.test(s)) p.push('generic placeholder name');
  return p;
}

const YEAR_RE = /(?<![\p{L}\d./-])(1[89]\d\d|20[0-3]\d)[a-z]?(?![\d])/gu;

function extractYears(s: string): { years: number[]; cited?: number } {
  // remove identifiers & urls & page ranges first
  const t = s
    .replace(URL_RE, ' ')
    .replace(DOI_RE, ' ')
    .replace(/\d{4}\.\d{4,5}/g, ' ')
    .replace(/\b\d+\s*[-–]\s*\d+\b/g, (m) => (/^(1[89]|20)\d\d\s*[-–]\s*(1[89]|20)?\d\d$/.test(m) ? m : ' '));
  const years: number[] = [];
  for (const m of t.matchAll(YEAR_RE)) years.push(parseInt(m[1], 10));
  const paren = t.match(/\((1[89]\d\d|20[0-3]\d)[a-z]?(?:,[^)]*)?\)/);
  const now = new Date().getFullYear() + 1;
  const valid = years.filter((y) => y <= now);
  let cited: number | undefined;
  if (paren) cited = parseInt(paren[1], 10);
  else if (valid.length) {
    // ACM/Chicago: "Authors. 2020. Title" — year right after the author block
    const acm = t.match(/\.\s(1[89]\d\d|20[0-3]\d)[a-z]?\.\s/);
    cited = acm ? parseInt(acm[1], 10) : valid[valid.length - 1];
  }
  return { years: valid, cited };
}

/* ---------------------------- authors ---------------------------- */

const INITIALS_RE = /^(?:(?:\p{Lu}[a-z]?\.\s*-?\s*){1,4}\p{Lu}?|\p{Lu}{1,3})$/u;
const NAME_TOKEN_RE = /^[\p{Lu}][\p{L}'’`?-]*\.?$|^(?:van|von|der|den|de|del|della|di|da|du|le|la|dos|das|bin|al|el|ten|ter)$/u;

function isInitials(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length <= 14 && INITIALS_RE.test(t);
}

/** Does this text look like a list of personal/organization author names? Returns [0..1]. */
export function authorLikeness(text: string): number {
  const t = text.replace(/\bet\s*al\.?|\band others\b/gi, '').trim();
  if (!t) return 0;
  if (t.length > 6000) return 0;
  const items = t
    .split(/\s*(?:,|;|\band\b|&)\s*/u)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!items.length) return 0;
  let good = 0;
  for (const it of items) {
    const toks = it.split(/\s+/);
    if (isInitials(it)) {
      good++;
      continue;
    }
    if (toks.length > 5) continue;
    const nameish = toks.filter((x) => NAME_TOKEN_RE.test(x) || isInitials(x) || /^\p{Lu}{1,3}$/u.test(x)).length;
    if (nameish / toks.length >= 0.75) good++;
  }
  // a title-like segment has many lowercase function words
  const lowerWords = (t.match(/\s(?:of|for|the|in|on|with|to|from|a|an|via|using|is|are)\s/g) || []).length;
  const score = good / items.length - Math.min(0.6, lowerWords * 0.2);
  return Math.max(0, score);
}

export function parseAuthors(text: string): { authors: Person[]; etAl: boolean } {
  let t = text.trim();
  const etAl = /\bet\.?\s*al\b|\bal\.?,?\s*et\b|\band others\b|\.\.\.|…/i.test(t);
  t = t
    .replace(/\(eds?\.?\)|\beds?\.\s*$/gi, '')
    .replace(/,?\s*(?:and\s+|&\s*)?(?:et\.?\s*al\.?|al\.?,?\s*et\.?),?/gi, ',') // keep the separator: "Doe, K., et al., Lee, M."
    .replace(/\band others\b|…|\.\.\./gi, '')
    .replace(/^\s*(?:by)\s+/i, '')
    .trim()
    .replace(/[.,;\s]+$/, '');
  if (!t) return { authors: [], etAl };

  let parts: string[];
  if (t.includes(';')) parts = t.split(/\s*;\s*/);
  else parts = t.split(/\s*,\s*/);
  parts = parts.flatMap((p) => p.split(/\s+(?:and|&)\s+|^(?:and|&)\s+/)).map((p) => p.replace(/^(?:and|&)\s+/, '').trim()).filter(Boolean);

  const people: Person[] = [];
  // Detect inverted "Family, G." pairs: items alternate name / initials
  const initialsCount = parts.filter(isInitials).length;
  const inverted = !t.includes(';') && initialsCount >= Math.max(1, Math.floor(parts.length / 2) - 1) && parts.length >= 2 && isInitials(parts[1] ?? '');
  if (inverted) {
    for (let i = 0; i < parts.length; i++) {
      const fam = parts[i];
      const nxt = parts[i + 1];
      if (nxt && isInitials(nxt) && !isInitials(fam)) {
        people.push({ family: fam, given: nxt });
        i++;
      } else if (!isInitials(fam)) {
        people.push(splitName(fam));
      }
    }
    return { authors: finalizePeople(people), etAl };
  }
  for (const p of parts) {
    if (isInitials(p) && people.length) continue; // dangling initials
    if (p.includes(',')) {
      const [fam, giv] = p.split(/\s*,\s*/);
      people.push({ family: fam, given: giv });
    } else people.push(splitName(p));
  }
  return { authors: finalizePeople(people), etAl };
}

const JUNK_FAMILY = new Set(['al', 'et', 'others', 'and', 'eds', 'ed', 'jr']);
function finalizePeople(people: Person[]): Person[] {
  return people
    .map((p) => ({ family: p.family.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''), given: p.given }))
    .filter((x) => x.family.length > 1 && !JUNK_FAMILY.has(x.family.toLowerCase()));
}

function splitName(p: string): Person {
  const toks = p.replace(/\.(?=\p{L})/gu, '. ').split(/\s+/).filter(Boolean);
  if (toks.length === 1) return { family: toks[0] };
  // Vancouver "Smith JA" — trailing all-caps initials
  const last = toks[toks.length - 1];
  // ("Hu Zz" for Zhi-zhong Hu: hyphenated given names keep a lowercase second initial)
  if ((/^\p{Lu}{1,3}$/u.test(last) || /^(\p{Lu})(\p{Ll})$/u.test(last) && last[1] === last[0].toLowerCase()) && toks.length >= 2 && !/^\p{Lu}{1,3}$/u.test(toks[0])) {
    return { family: toks.slice(0, -1).join(' '), given: last };
  }
  // "Holovatch Yu.", "Krasnytska M.", "Timoshyn D." — family first, dotted initials after
  if (toks.length >= 2 && /^\p{Lu}[\p{Ll}]?\.$/u.test(last) && !/\.$/.test(toks[0]) && toks.slice(1).every((t) => /^\p{Lu}[\p{Ll}]?\.$/u.test(t))) {
    return { family: toks[0], given: toks.slice(1).join(' ') };
  }
  // particles: "Ludwig van Beethoven" → family "van Beethoven"
  let i = toks.length - 1;
  while (i > 1 && /^(?:van|von|der|den|de|del|della|di|da|du|le|la|dos|das|bin|ten|ter)$/i.test(toks[i - 1])) i--;
  return { family: toks.slice(i).join(' ').replace(/\.$/, ''), given: toks.slice(0, i).join(' ') };
}

/* ---------------------------- segmentation ---------------------------- */

/** Split a reference into sentence-like segments, not breaking after initials/abbreviations. */
export function segments(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  const re = /([.?!])(\s+|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const piece = s.slice(last, m.index + 1);
    last = m.index + m[0].length;
    cur += piece;
    const words = piece.trim().split(/\s+/);
    const lastWord = (words[words.length - 1] || '').replace(/[.?!]$/, '').replace(/^[(\[“"‘]+/, '');
    const lw = lastWord.toLowerCase();
    // "R." and hyphenated initials of East Asian given names ("T.-Y.", "C.-Y.")
    const isInitial = m[1] === '.' && (/^\p{Lu}$/u.test(lastWord) || /^(?:\p{Lu}\.-?)+\p{Lu}$/u.test(lastWord) || /^\p{Lu}\.?-\p{Lu}$/u.test(lastWord));
    const isAbbrev = m[1] === '.' && (ABBREV.has(lw) || /^(?:\p{Lu}\.){1,3}\p{Lu}?$/u.test(lastWord + '.'));
    const nextChar = s[last] ?? '';
    // "et al. Title": a sentence break when followed by an uppercase/quote start
    const etAlBreak = lw === 'al' && /[\p{Lu}“"‘]/u.test(nextChar);
    if ((isInitial || (isAbbrev && !etAlBreak)) && last < s.length) {
      cur += m[2];
      continue;
    }
    out.push(cur.trim());
    cur = '';
  }
  const rest = (cur + s.slice(last)).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/* ---------------------------- main parse ---------------------------- */

export function parseReference(input: string): ParsedRef {
  const raw = cleanRefString(input);
  let s = raw;
  let label: string | undefined;
  const lab = s.match(/^\s*(?:\[(\w{1,12})\]|\((\d{1,4})\)|(\d{1,4})\.(?=\s)|(\d{1,4})\s(?=\p{Lu}))\s*/u);
  if (lab) {
    label = lab[1] ?? lab[2] ?? lab[3] ?? lab[4];
    s = s.slice(lab[0].length);
  }
  const dois = extractDois(s);
  const arxivIds = extractArxiv(s);
  const urls = [...s.matchAll(URL_RE)].map((m) => stripTrailingPunct(m[0]));
  const pmidM = s.match(/\bPMID:?\s*(\d{5,9})/i);
  const placeholders = detectPlaceholders(s);
  const { years, cited: year } = extractYears(s);
  const nowYear = new Date().getFullYear();
  const future = [...s.replace(/https?:\/\/\S+|10\.\d{4,9}\/\S+/g, ' ').replace(/\b(?:issn|isbn|eissn)[:\s]*[\dxX-]+/gi, ' ').matchAll(/(?<![\d-])(20[3-9]\d)(?![\d-])/g)].map((m) => +m[1]).filter((y) => y > nowYear + 1);
  if (future.length) placeholders.push(`publication year ${future[0]} is in the future`);

  // text without urls/dois for title/author parsing
  const body = s
    // APA "Smith, J., Doe, K., . . . Lee, M." — only after a comma or an initial, not inside a title ("science: . . .Error")
    .replace(/(?:,\s*|(?<=\b\p{Lu}\.)\s*)(?:(?:\.\s?){3}|…)\s*(?=&|\p{Lu})/gu, ', et al., ')
    .replace(/\.\s?\.\s?\./g, '…') // any other ellipsis is part of a title and must not end a segment
    .replace(/\b(?:doi|DOI)\s*:?\s*10\.\S+/g, ' ')
    .replace(URL_RE, ' ')
    .replace(/\b(?:url|URL|Available (?:at|from)|Retrieved from|Accessed|\(visited on [^)]*\))\s*:?/g, ' ')
    .replace(/(?:,\s*)?\b(?:in\s+)?(?:arxiv\s+preprint|corr|arxiv)\b[\s,:]*(?:arxiv)?[\s,:]*(?:abs\/)?\d{4}\.[\dXx?_]{3,5}(?:v\d+)?(?:\s*\[[^\]]*\])?/gi, '. arXiv. ')
    .replace(/(\p{Ll})\.(\p{Lu}\p{Ll}{2,})/gu, '$1. $2')
    .replace(/\s+/g, ' ')
    .replace(/(?:\.\s*){2,}/g, '. ')
    .trim();

  let title: string | undefined;
  let authorsText: string | undefined;
  let after: string | undefined;
  let yearAfterAuthors: number | undefined;
  let publisherParen = false;

  // (a) quoted title
  const q = [...body.matchAll(/[“"‘«]([^”"’»]{8,400})[”"’»]/g)].sort((a, b) => b[1].length - a[1].length)[0];
  if (q && (q[1].trim().split(/\s+/).length >= 2 || (q[1].trim().length >= 6 && /^[,.]/.test(body.slice((q.index ?? 0) + q[0].length))))) {
    title = q[1].trim().replace(/[,.]$/, '');
    authorsText = body.slice(0, q.index).replace(/[\s,:.]+$/, '');
    after = body.slice((q.index ?? 0) + q[0].length);
    // remove trailing year in authors (Chicago "Smith, John. 2020. “Title.”")
    authorsText = authorsText.replace(/[\s.(]*(1[89]\d\d|20[0-3]\d)[a-z]?[).]*$/, '').trim();
  }

  // (b) APA / Harvard: Authors (2020). Title. Venue
  if (!title) {
    const apa = body.match(/^(.{2,1500}?)\s*\(\s*(?:1[89]\d\d|20[0-3]\d|n\.\s?d\.)[a-z]?(?:,\s*[^)]{0,40})?\)\s*[.,:]?\s*(.+)$/);
    if (apa) {
      authorsText = apa[1];
      const segs = segments(apa[2]);
      title = segs[0];
      after = segs.slice(1).join(' ');
    }
  }

  // (b2) econ / finance: "Brennan, T. J., and A. W. Lo, 2012, Title, Journal 7, e50310."
  //      and comma-after-parenthesis APA variants: "Holovatch Yu., Honchar Y. (2018), TITLE, Journal, v. 22"
  if (!title || /^\s*\((?:1[89]\d\d|20[0-3]\d)[a-z]?\)\s*,/.test(body.slice((authorsText ?? '').length).trimStart())) {
    const ec = [body.match(/^(.{2,6000}?),\s(1[89]\d\d|20[0-3]\d)([a-z])?,\s(.+)$/u), body.match(/^(.{2,6000}?)\s*\((1[89]\d\d|20[0-3]\d)([a-z])?\)\s*,\s*(.+)$/u)].find((m) => m && authorLikeness(m[1]) >= 0.7);
    if (ec && !/^[“"‘«]/.test(ec[4])) {
      const sp = splitTitleComma(ec[4]);
      authorsText = ec[1];
      title = sp.title;
      after = sp.after;
      publisherParen = sp.publisher;
      yearAfterAuthors = parseInt(ec[2], 10);
    }
  }

  // (b3) Springer LNCS: "Celeux, G., Govaert, G.: Gaussian parsimonious clustering models. Pattern Recognition 28(5)"
  if (!title) {
    const sp = body.match(/^(.{2,6000}?[\s.,-]\p{Lu}\.):\s+(.+)$/u);
    if (sp && authorLikeness(sp[1]) >= 0.8) {
      const segs = segments(sp[2]);
      authorsText = sp[1];
      title = segs[0];
      after = segs.slice(1).join(' ');
    }
  }

  // (c) ACM style: Authors. 2020. Title. Venue
  if (!title) {
    const acm = body.match(/^(.{2,1500}?)\.\s(?:1[89]\d\d|20[0-3]\d)[a-z]?\.\s(.+)$/);
    if (acm && authorLikeness(acm[1]) > 0.6) {
      authorsText = acm[1];
      const segs = segments(acm[2]);
      title = segs[0];
      after = segs.slice(1).join(' ');
    }
  }

  // (d) Generic: Authors. Title. Venue — choose the first boundary whose prefix is author-like
  if (!title) {
    const segs = segments(body);
    let split = -1;
    let acc = '';
    for (let i = 0; i < Math.min(segs.length - 1, 6); i++) {
      acc = acc ? acc + ' ' + segs[i] : segs[i];
      if (authorLikeness(acc.replace(/\.$/, '')) >= 0.75) {
        split = i;
        // keep extending while next segment is still name-like (Vancouver "Smith J, Doe A.")
        const nxt = segs[i + 1];
        // (it must carry an initial, a comma or "and": "Fast R-CNN." is a title, not more names)
        if (nxt && authorLikeness(nxt.replace(/\.$/, '')) >= 0.95 && nxt.split(/\s+/).length <= 4 && segs.length > i + 2 && /(?:^|\s)\p{Lu}{1,3}(?:\.|(?=,|$))|,|\band\b|&/u.test(nxt.replace(/\.$/, ''))) continue;
        break;
      }
    }
    if (split >= 0) {
      authorsText = segs.slice(0, split + 1).join(' ');
      title = segs[split + 1];
      after = segs.slice(split + 2).join(' ');
    } else if (segs.length >= 2 && segs[0].split(/\s+/).length <= 6) {
      // organization author: "Microsoft Corporation. (2025). Title"
      authorsText = segs[0];
      title = segs[1];
      after = segs.slice(2).join(' ');
    } else {
      title = segs[0];
      after = segs.slice(1).join(' ');
    }
  }

  // (e) Vancouver fallback ("Wren JD, Bateman A. Title. Journal."): split at every period, including
  // after a lone initial, and take the first boundary where the prefix is an author list and the next piece is not
  if (!authorsText || authorLikeness(authorsText.replace(/\.$/, '')) < 0.5) {
    const pieces = body.split(/(?<=\.)\s+/);
    let acc = '';
    for (let i = 0; i < Math.min(pieces.length - 1, 40); i++) {
      acc = acc ? `${acc} ${pieces[i]}` : pieces[i];
      const nxt = pieces[i + 1] ?? '';
      if (authorLikeness(acc.replace(/\.$/, '')) >= 0.8 && authorLikeness(nxt.replace(/\.$/, '')) < 0.5 && /[a-z]{3}/.test(nxt) && acc.length > 2) {
        const segs = segments(pieces.slice(i + 1).join(' '));
        authorsText = acc.replace(/\.$/, '');
        title = segs[0];
        after = segs.slice(1).join(' ');
        break;
      }
    }
  }

  if (title) {
    title = title
      .replace(/^\s*(?:In:|In)\s+/, '')
      .replace(/[.,;:\s]+$/, '')
      .replace(/\s*\[[^\]]*\]\s*$/, '') // translated title / medium in brackets
      .replace(/,?\s*in these proceedings$|,?\s*\(?this volume\)?$/i, '')
      .replace(/,\s*volume\s+\d+\s+of\s+.+$/i, '') // "Title, volume 99 of Series"
      .replace(/\s*\((?:no\.|vol\.|volume|[^()]*\beds?\.)[^()]*\)\s*$/i, '') // "(No. 137)", "(Vol. 26, …)", "(J. B. Carroll, Ed.)"
      .replace(/,?\s*\(?(?:\d+(?:st|nd|rd|th)|second|third|fourth|revised)\s+(?:edn|ed|edition)\.?\)?$/i, '') // "2nd edn"
      .replace(/\s+\p{Lu}[\p{L}.]+(?:,\s*(?:\p{Lu}\.){1,3}|,\s*\p{Lu}{2})?\s*:\s*[^:]+$/u, (m) => (PUBLISHER_RE.test(m) ? '' : m)) // "As I remember Princeton, N.J.: Van Nostrand"
      .replace(/[.,;:\s]+$/, '')
      .trim();
    // no title at all: "Cockcroft, J.D. and Walton, E.T. (1932). Proc. Roy. Soc. A, 136, 619."
    const rest = `${title} ${after ?? ''}`.trim();
    if (/^\p{Lu}[\p{L}]{0,7}\.\s*(?:\p{Lu}[\p{L}]{0,7}\.?\s*){0,4}(?:\p{Lu}\b\.?)?,?\s*\d{1,4}\s*[,(:]\s*\d+/u.test(rest)) {
      after = rest;
      title = undefined;
    }
    if (title && title.split(/\s+/).length < 2 && after) {
      // e.g. "Mistral 7B." is fine; but single token like "CoRR" is not a title
      if (title.length < 4) title = undefined;
    }
  }

  const parsedAuthors = authorsText ? parseAuthors(authorsText.replace(/\(\s*(?:1[89]\d\d|20[0-3]\d)[^)]*\)\s*$/, '')) : { authors: [], etAl: false };
  const authors = parsedAuthors.authors;
  // "—, and Otani, S." / "___. 2019." — the first author(s) are repeated from the previous entry
  const etAl = parsedAuthors.etAl || /^\s*(?:[-_]{1,}|—)\s*(?:,|and\b|&|\.|$)/.test(authorsText ?? body);

  // venue & volume/pages from the remainder
  let venue: string | undefined;
  let volume: string | undefined;
  let issue: string | undefined;
  let pages: string | undefined;
  if (after) {
    let v = after.replace(/^[\s.]*(?:In:|In\s|in:)\s*/, '');
    v = v.replace(/^.*?\(eds?\.?\),?\s*/i, '');
    v = v.replace(/\b(?:Ed\.|Eds\.|edited) by [^.]+\.?/i, '');
    // pages: explicit "pp."/"pages", or after a volume colon/comma; never ISSN/ISBN, dates or issue ranges
    const pv = v.replace(/\b(?:ISSN|ISBN|eISSN)[:\s]*[\dXx-]+/gi, ' ').replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\s*[-–]\s*\d{1,2}\b/gi, ' ').replace(/\(\s*\d{1,4}\s*[-–]\s*\d{1,4}\s*\)/g, ' ');
    const pm = pv.match(/\b(?:pp?\.|pages)\s*(\d{1,6})\s*[-–?]\s*(\d{1,6})\b/i) ?? pv.match(/[:,]\s*(\d{1,6})\s*[-–?]\s*(\d{1,6})\b(?!\s*\))/);
    if (pm && !/^(1[89]|20)\d\d$/.test(pm[1])) pages = `${pm[1]}-${pm[2]}`;
    const vm = v.match(/\b(?:vol(?:ume)?\.?\s*)?(\d{1,4})\s*(?:\((\d{1,4}(?:[-–]\d{1,4})?)\)|\.(\d{1,3})\b)/i);
    if (vm) {
      volume = vm[1];
      issue = vm[2] ?? vm[3];
    }
    venue = v
      .split(/,\s*(?:vol|pp?\.|pages|volume|\d)|\s\d{1,4}\s*\(|\(\s*(?:1[89]|20)\d\d|;\s*\d|\s(?:1[89]|20)\d\d\b(?!\s+(?:conference|annual|international|meeting|workshop|joint|ieee|acm|[a-z]+\s+conference))/i)[0]
      .replace(/[.,;:\s]+$/, '')
      .replace(/^[\s.,;:]+/, '')
      .trim();
    if (venue.length < 2) venue = undefined;
  }

  let kind = classifyKind(raw, urls, dois, arxivIds, venue);
  if (kind === 'article' && !arxivIds.length && (publisherParen || (venue && looksLikePublisher(venue)) || (!dois.length && PUBLISHER_RE.test(raw) && !/journal|proceedings|conference|transactions|\d+\s*\(\d+\)/i.test(raw)))) kind = 'book';
  // "…, Dubna: JINR" / ". Kyiv: Phenix": ends in City: Publisher with no volume or pages after the year
  if (kind === 'article' && !arxivIds.length && !dois.length && !urls.length && year && CITY_PUBLISHER_END_RE.test(raw) && !/\d/.test(raw.slice(raw.indexOf(String(year)) + 4).replace(/\(\s*in [A-Z][a-z]+\s*\)/g, '')) && !/journal|proceedings|conference|transactions/i.test(raw)) kind = 'book';

  return {
    raw,
    clean: body,
    label,
    dois,
    arxivIds,
    urls,
    pmid: pmidM?.[1],
    year: yearAfterAuthors ?? year,
    years,
    authors,
    authorsText,
    etAl,
    title,
    venue,
    volume,
    issue,
    pages,
    kind,
    placeholders,
  };
}

/** Split "Title, Venue 7, 55-108." / "Title, in Proceedings …" / "Title (Publisher, City)." at the title's end. */
function splitTitleComma(rest: string): { title: string; after: string; publisher: boolean } {
  let r = rest.trim();
  let tail = '';
  let publisher = false;
  const pub = r.match(/\s*\(([^()]{3,120})\)\.?\s*$/);
  if (pub && /,|press|books|publish|norton|wiley|springer|viking|penguin|crc|hall/i.test(pub[1]) && !/^\d|^eds?\.?$|^vol/i.test(pub[1])) {
    tail = pub[1];
    r = r.slice(0, pub.index).trim();
    publisher = true;
  }
  const ax = r.match(/\.\s+arXiv\.?\s*$/i);
  if (ax) {
    tail = 'arXiv' + (tail ? ', ' + tail : '');
    r = r.slice(0, ax.index).trim();
  }
  const pieces = r.split(/,\s+/);
  let cut = pieces.length;
  for (let i = 1; i < pieces.length; i++) {
    const x = pieces[i];
    if (
      /^(?:in\s|in:|arxiv|working paper|nber|mimeo|unpublished|forthcoming|vol\.?\s|v\.\s|pp?\.\s|ed\.|eds\.|no\.\s|\d|ph\.?\s?d|doctoral|master'?s|thesis|dissertation|technical report|tech\.)/i.test(x) ||
      /^(?:\p{Lu}|\p{Ll}+\p{Lu})[\p{L}\d&.'’ -]*\s\d+[a-z]?\b/u.test(x) ||
      /\b(?:journal|review|proceedings|transactions|letters|quarterly|annals|bulletin|magazine|press|university|publishing|publishers?)\b/i.test(x) ||
      /^\p{Lu}[\p{L}. ]+:\s*\p{Lu}/u.test(x)
    ) {
      cut = i;
      break;
    }
  }
  return { title: pieces.slice(0, cut).join(', ').replace(/[.\s]+$/, ''), after: [pieces.slice(cut).join(', '), tail].filter(Boolean).join(', '), publisher };
}

const CITY_PUBLISHER_END_RE = /[.,]\s*\p{Lu}[\p{L}-]+(?:[\s-]\p{Lu}[\p{L}-]+)?\s*:\s*\p{Lu}[\p{L}&.'’\s-]{1,40}?\.?(?:\s*\(\s*in [A-Z][a-z]+\s*\))?\.?\s*$/u;
const PUBLISHER_RE = /\b(?:press|publishers?|publishing|books|verlag|ltd|wiley|springer|elsevier|routledge|sage|norton|penguin|viking|vintage|chapman|crc|blackwell|mcgraw|prentice|addison|pearson|kluwer|birkh[aä]user|dover|freeman|van nostrand|simon (?:and|&) schuster|random house|harper|knopf|allen lane|hamish hamilton|odile jacob|north-holland|basicbooks|siam)\b/i;
/** "London: Allen Lane", "Wiley, Chichester", "New Haven & London: Yale University Press" — a book's imprint, not a venue. */
function looksLikePublisher(v: string): boolean {
  if (/journal|proceedings|transactions|conference|symposium|workshop|letters|review|magazine|bulletin|\d+\s*\(\d/i.test(v)) return false;
  return PUBLISHER_RE.test(v) || /^[\s,]*\p{Lu}[\p{L}.]*(?:[\s&,]+\p{Lu}[\p{L}.()]*)*\s?:\s?\p{Lu}/u.test(v);
}

const SOFTWARE_HOSTS = /github\.com|gitlab\.com|bitbucket\.org|pypi\.org|cran\.r-project\.org|npmjs\.com|huggingface\.co|sourceforge\.net|crates\.io/i;

function classifyKind(raw: string, urls: string[], dois: string[], arxiv: string[], _venue?: string): RefKind {
  const r = raw.toLowerCase();
  if (arxiv.length) return 'article';
  // standards and specifications
  if (/\b(?:ansi|niso|iso(?:\/iec)?|ieee std|rfc|w3c|ietf|astm)\s*[/\s]?\s*[a-z]?\d/i.test(raw) && !dois.length) return 'web';
  if (urls.some((u) => SOFTWARE_HOSTS.test(u) && !/huggingface\.co\/(?:blog|docs|papers|learn|posts)\b/i.test(u)) || /\[computer software\]|\(version [\d.]+\)/.test(r)) {
    if (/\bdataset\b/.test(r)) return 'dataset';
    return 'software';
  }
  if (/\bdataset\b|\bdata set\b|\bcorpus\b/.test(r) && (dois.some((d) => /zenodo|figshare|dryad|ordo|5061|6084|21954/.test(d)) || urls.length)) return 'dataset';
  if (/\b(?:ph\.?\s?d\.?|master'?s|doctoral)\s+(?:thesis|dissertation)|\bdissertation\b|\bthesis\b/.test(r)) return 'thesis';
  if (/\btech(?:nical)?\.?\s*rep(?:ort)?\b|white\s*paper|working paper/.test(r)) return 'report';
  const scholarlyVenue = /proceedings|journal|conference|transactions|\bin:/.test(r);
  // encyclopedia / dictionary entries are not indexed as scholarly works
  if (/encyclop(?:a)?edia|\bdictionary\b|wikipedia|\bglossary\b/.test(r) && !dois.length) return 'web';
  if (/model card|\bansi\b|\biso\s?\d|\bniso\b|\brfc\s?\d|\bw3c\b|\bblog\b/.test(r) && !dois.length && !scholarlyVenue) return 'web';
  if (!dois.length && urls.length && !scholarlyVenue) return 'web';
  if (/\bpress\b|\bpublishers?\b|\bisbn\b|\(eds?\.\)|\bedition\b|\bed\.\s/.test(r) && !/proceedings|journal|conference/.test(r)) return 'book';
  void fold;
  return 'article';
}
