import { parseBibtex, parsedFromBib } from '../core/bibtex';
import { buildDoc, buildDocFromText, findCitations, type Doc } from '../core/doc';
import { cleanRefString, parseReference } from '../core/parse';
import { pdfToLines } from '../core/pdf';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })();
  }
  return pdfjsPromise;
}

export async function docFromPdf(data: ArrayBuffer, onProgress?: (p: number) => void): Promise<Doc> {
  const lib = await pdfjs();
  const { lines, pageWidths } = await pdfToLines(lib, data, onProgress);
  return buildDoc(lines, pageWidths);
}

export async function docFromDocx(data: ArrayBuffer): Promise<Doc> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ arrayBuffer: data });
  return buildDocFromText(value);
}

/* ------------------------------ BibTeX ------------------------------ */

function bibFields(body: string): Record<string, string> {
  const f: Record<string, string> = {};
  const re = /(\w[\w-]*)\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const key = m[1].toLowerCase();
    let i = re.lastIndex;
    let val = '';
    if (body[i] === '{') {
      let depth = 0;
      const start = i;
      for (; i < body.length; i++) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}' && --depth === 0) break;
      }
      val = body.slice(start + 1, i);
      i++;
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      val = body.slice(i + 1, end);
      i = end + 1;
    } else {
      const mm = body.slice(i).match(/^[^,\n}]+/);
      val = mm ? mm[0] : '';
      i += val.length;
    }
    f[key] = val.replace(/[{}]/g, '').replace(/\\[`'^"~=.]\{?(\w)\}?/g, '$1').replace(/\s+/g, ' ').trim();
    re.lastIndex = i;
  }
  return f;
}

export function bibtexToReferences(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/@(\w+)\s*\{\s*([^,]*),([\s\S]*?)\n\s*\}\s*(?=@|$)/g)) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue;
    const f = bibFields(m[3]);
    const authors = (f.author ?? f.editor ?? '')
      .split(/\s+and\s+/i)
      .map((a) => (a.includes(',') ? a.split(',').reverse().join(' ').trim() : a))
      .filter(Boolean);
    const au = authors.length > 1 ? authors.slice(0, -1).join(', ') + ', and ' + authors[authors.length - 1] : authors[0] ?? '';
    const venue = f.journal ?? f.booktitle ?? f.publisher ?? f.howpublished ?? f.school ?? f.institution ?? '';
    const ids = [f.doi ? `doi:${f.doi}` : '', f.eprint && /arxiv/i.test(f.archiveprefix ?? f.eprinttype ?? 'arxiv') ? `arXiv:${f.eprint}` : '', !f.doi && f.url ? f.url : ''].filter(Boolean).join(' ');
    const vol = [f.volume, f.number ? `(${f.number})` : ''].join('');
    out.push(cleanRefString(`${au}. ${f.title ?? ''}. ${venue}${vol ? ', ' + vol : ''}${f.pages ? ', ' + f.pages.replace(/--/, '-') : ''}, ${f.year ?? ''}. ${ids}`));
  }
  return out;
}

export function docFromBibtex(src: string): Doc {
  // structured fields are verified directly (no lossy re-parsing of a formatted string)
  const entries = parseBibtex(src);
  const references = entries.length ? entries.map((e) => ({ ...parsedFromBib(e.fields, e.type), label: e.key })) : bibtexToReferences(src).map(parseReference);
  return { sentences: [], references, rawReferences: references.map((r) => r.raw), citances: [], style: 'unknown', stats: { pages: 0, words: 0 } };
}

export function docFromText(text: string): Doc {
  if (/@\w+\s*\{[^,]+,/.test(text) && /\btitle\s*=/.test(text)) return docFromBibtex(text);
  const d = buildDocFromText(text);
  if (!d.citances.length && d.sentences.length) Object.assign(d, findCitations(d.sentences, d.references));
  return d;
}

export function parseArxivInput(s: string): string | null {
  const m = s.trim().match(/^(?:arxiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?)$|arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  return m ? (m[1] ?? m[2]) : null;
}

export async function fetchArxivPdf(id: string): Promise<ArrayBuffer> {
  const res = await fetch(`https://arxiv.org/pdf/${id}`);
  if (!res.ok) throw new Error(`arXiv returned ${res.status} for ${id}`);
  return res.arrayBuffer();
}
