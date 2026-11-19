/** Structured BibTeX → ParsedRef (more faithful than re-parsing a formatted string). */
import { cleanRefString, decodeEntities, parseAuthors, extractArxiv } from './parse';
import type { ParsedRef, RefKind } from './types';

export type BibFields = Record<string, string | undefined>;

function unbrace(s?: string): string | undefined {
  if (!s) return s;
  return decodeEntities(s)
    .replace(/\\[`'^"~=.uvHc]\{?\s*(\w)\}?/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function bibAuthors(a?: string) {
  if (!a) return { authors: [], etAl: false };
  const parts = unbrace(decodeEntities(a))!
    .split(/\s+and\s+/i)
    .map((x) => x.trim())
    .filter(Boolean);
  const etAl = parts.some((p) => /^others$/i.test(p));
  const authors = parts
    .filter((p) => !/^others$/i.test(p))
    .map((p) => {
      if (p.includes(',')) {
        const [family, given] = p.split(/\s*,\s*/);
        return { family, given };
      }
      return parseAuthors(p).authors[0] ?? { family: p };
    })
    .filter((x) => x.family);
  return { authors, etAl };
}

export function parsedFromBib(fields: BibFields, type = 'article'): ParsedRef {
  const f: BibFields = {};
  for (const [k, v] of Object.entries(fields)) f[k.toLowerCase()] = unbrace(v);
  const { authors, etAl } = bibAuthors(fields.author ?? fields.editor);
  const venue = f.journal ?? f.booktitle ?? f.howpublished ?? f.school ?? f.institution ?? f.publisher;
  const y = f.year ? parseInt(f.year, 10) : undefined;
  const doi = f.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
  const arx = [f.eprint && /^\d{4}\.\d{4,5}/.test(f.eprint) ? f.eprint : undefined, ...extractArxiv([f.url, f.doi, f.journal, f.note].filter(Boolean).join(' '))].filter((x): x is string => !!x);
  const urls = f.url && !/doi\.org|arxiv\.org/i.test(f.url) ? [f.url] : [];
  const raw = cleanRefString(
    `${authors.map((a) => (a.given ? `${a.given} ${a.family}` : a.family)).join(', ')}${etAl ? ', et al.' : ''}. ${f.title ?? ''}. ${venue ?? ''}${f.volume ? `, ${f.volume}` : ''}${f.pages ? `, ${f.pages}` : ''}, ${f.year ?? ''}.${doi ? ` doi:${doi}` : ''}${f.url ? ` ${f.url}` : ''}`,
  );
  const kindMap: Record<string, RefKind> = { book: 'book', phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report', misc: urls.length ? 'web' : 'article', software: 'software', dataset: 'dataset', online: 'web' };
  const placeholders: string[] = [];
  if (/X{3,}|\?\?\?|TBD|TODO|to be (?:updated|added)/i.test(raw)) placeholders.push('unfilled template text');
  if (/\bfirst\s*name\b|\blast\s*name\b/i.test(raw)) placeholders.push('template author name');
  if (y && y > new Date().getFullYear() + 1) placeholders.push(`publication year ${y} is in the future`);
  return {
    raw,
    clean: raw.replace(/https?:\/\/\S+/g, ''),
    dois: doi && !/^10\.48550\/arxiv/i.test(doi) ? [doi] : [],
    arxivIds: [...new Set(arx)],
    urls,
    year: Number.isFinite(y) ? y : undefined,
    years: Number.isFinite(y) ? [y!] : [],
    authors,
    authorsText: f.author,
    etAl,
    title: f.title,
    venue,
    volume: f.volume,
    issue: f.number,
    pages: f.pages?.replace(/--?/, '-'),
    kind: kindMap[type.toLowerCase()] ?? 'article',
    placeholders,
  };
}

/** Parse a .bib file into structured entries. */
export function parseBibtex(src: string): { type: string; key: string; fields: BibFields }[] {
  const out: { type: string; key: string; fields: BibFields }[] = [];
  const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    // find matching closing brace of the entry
    let depth = 1;
    let i = re.lastIndex;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    const body = src.slice(re.lastIndex, i - 1);
    re.lastIndex = i;
    const fields: BibFields = {};
    const fr = /(\w[\w-]*)\s*=\s*/g;
    let fm: RegExpExecArray | null;
    while ((fm = fr.exec(body))) {
      let j = fr.lastIndex;
      let val = '';
      if (body[j] === '{') {
        let d = 0;
        const s = j;
        for (; j < body.length; j++) {
          if (body[j] === '{') d++;
          else if (body[j] === '}' && --d === 0) break;
        }
        val = body.slice(s + 1, j);
        j++;
      } else if (body[j] === '"') {
        const e = body.indexOf('"', j + 1);
        val = body.slice(j + 1, e);
        j = e + 1;
      } else {
        const mm = body.slice(j).match(/^[^,\n}]+/);
        val = mm ? mm[0].trim() : '';
        j += mm ? mm[0].length : 0;
      }
      fields[fm[1].toLowerCase()] = val;
      fr.lastIndex = j;
    }
    out.push({ type, key: m[2], fields });
  }
  return out;
}
