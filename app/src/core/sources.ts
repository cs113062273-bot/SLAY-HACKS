/** Adapters for free scholarly indexes → normalized WorkRecord. All endpoints are CORS-enabled. */
import type { Http } from './http';
import type { Person, WorkRecord } from './types';

const enc = encodeURIComponent;

function splitFullName(name: string): Person {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.includes(',')) {
    const [family, given] = n.split(/\s*,\s*/);
    return { family, given };
  }
  const toks = n.split(' ');
  if (toks.length === 1) return { family: toks[0] };
  let i = toks.length - 1;
  while (i > 1 && /^(?:van|von|der|den|de|del|della|di|da|du|le|la|dos|das|bin|ten|ter)$/i.test(toks[i - 1])) i--;
  return { family: toks.slice(i).join(' '), given: toks.slice(0, i).join(' ') };
}

function stripTags(s?: string): string | undefined {
  return s?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function yearsFromParts(...parts: any[]): number[] {
  const ys: number[] = [];
  for (const p of parts) {
    const y = p?.['date-parts']?.[0]?.[0];
    if (typeof y === 'number') ys.push(y);
  }
  return [...new Set(ys)];
}

/* ------------------------------ Crossref ------------------------------ */

export function fromCrossref(it: any): WorkRecord {
  const years = yearsFromParts(it.issued, it['published-print'], it['published-online'], it.published, it.created);
  const title = stripTags(it.title?.[0]) ?? '';
  const sub = stripTags(it.subtitle?.[0]);
  return {
    source: 'crossref',
    sourceId: it.DOI,
    url: `https://doi.org/${it.DOI}`,
    title: sub && !title.toLowerCase().includes(sub.toLowerCase()) ? `${title}: ${sub}` : title,
    authors: (it.author ?? []).map((a: any) => (a.family ? { family: a.family, given: a.given } : splitFullName(a.name ?? ''))).filter((a: Person) => a.family),
    year: years[0],
    years,
    venue: stripTags(it['container-title']?.[0]) ?? it.event?.name,
    venueAliases: [...(it['container-title'] ?? []), ...(it['short-container-title'] ?? []), it.event?.name, it.event?.acronym].filter(Boolean).map((x: string) => stripTags(x)!),
    venueType: it.type,
    type: it.type,
    doi: it.DOI?.toLowerCase(),
    volume: it.volume,
    issue: it.issue,
    pages: it.page,
    abstract: stripTags(it.abstract?.replace(/<jats:title>[^<]*<\/jats:title>/g, '')),
    updates: (it['update-to'] ?? []).map((u: any) => ({ type: u.type, doi: u.DOI, label: u.label })),
  };
}

export async function crossrefBibliographic(http: Http, q: string, rows = 5): Promise<WorkRecord[]> {
  const j = await http.get(`https://api.crossref.org/works?query.bibliographic=${enc(q.slice(0, 600))}&rows=${rows}`);
  return (j?.message?.items ?? []).map(fromCrossref);
}

export async function crossrefDoi(http: Http, doi: string): Promise<WorkRecord | null> {
  const j = await http.get(`https://api.crossref.org/works/${enc(doi)}`);
  return j?.message ? fromCrossref(j.message) : null;
}

/** Retraction / correction notices that update a DOI. */
export async function crossrefUpdates(http: Http, doi: string): Promise<{ type: string; doi: string; label?: string }[]> {
  const j = await http.get(`https://api.crossref.org/works?filter=updates:${enc(doi)}&rows=5&select=DOI,update-to,type,title`);
  const out: { type: string; doi: string; label?: string }[] = [];
  for (const it of j?.message?.items ?? []) for (const u of it['update-to'] ?? []) if (u.DOI?.toLowerCase() === doi.toLowerCase()) out.push({ type: u.type, doi: it.DOI, label: u.label });
  return out;
}

/* ------------------------------ DataCite (arXiv, Zenodo, datasets) ------------------------------ */

export function fromDatacite(d: any): WorkRecord {
  const a = d.attributes ?? d;
  // publication year only: DataCite 'dates' include later update/version dates
  const years = [a.publicationYear].filter((y: any) => Number.isFinite(y));
  const arx = (a.identifiers ?? []).find((i: any) => i.identifierType === 'arXiv')?.identifier ?? (a.doi?.match(/arxiv\.(.+)$/i)?.[1] as string | undefined);
  return {
    source: 'datacite',
    sourceId: a.doi,
    url: `https://doi.org/${a.doi}`,
    title: a.titles?.[0]?.title ?? '',
    authors: (a.creators ?? []).map((c: any) => (c.familyName ? { family: c.familyName, given: c.givenName } : splitFullName(c.name ?? ''))),
    year: a.publicationYear,
    years: [...new Set<number>(years)],
    venue: a.publisher?.name ?? a.publisher,
    venueAliases: [a.publisher?.name ?? a.publisher].filter(Boolean),
    venueType: a.types?.resourceTypeGeneral,
    type: a.types?.resourceTypeGeneral,
    doi: a.doi?.toLowerCase(),
    arxivId: arx,
    abstract: a.descriptions?.find((x: any) => x.descriptionType === 'Abstract')?.description,
    pdfUrl: arx ? `https://arxiv.org/pdf/${arx}` : undefined,
  };
}

export async function dataciteDoi(http: Http, doi: string): Promise<WorkRecord | null> {
  const j = await http.get(`https://api.datacite.org/dois/${enc(doi)}`);
  return j?.data ? fromDatacite(j.data) : null;
}

export async function arxivRecord(http: Http, id: string): Promise<WorkRecord | null> {
  return dataciteDoi(http, `10.48550/arxiv.${id.replace(/v\d+$/, '')}`);
}

/* ------------------------------ OpenAlex ------------------------------ */

const OA_SELECT = 'id,doi,title,publication_year,publication_date,type,authorships,primary_location,locations,ids,is_retracted,biblio,abstract_inverted_index,is_authors_truncated,best_oa_location';

function invertedToText(inv?: Record<string, number[]>): string | undefined {
  if (!inv) return undefined;
  const arr: string[] = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) arr[p] = w;
  return arr.join(' ').replace(/\s+/g, ' ').trim();
}

export function fromOpenAlex(w: any): WorkRecord {
  const venues = (w.locations ?? [w.primary_location]).map((l: any) => l?.source?.display_name).filter(Boolean);
  const arx = (w.locations ?? []).map((l: any) => String(l?.landing_page_url ?? '').match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/)?.[1]).find(Boolean) ?? w.doi?.match(/arxiv\.(\d{4}\.\d{4,5})/i)?.[1];
  return {
    source: 'openalex',
    sourceId: w.id,
    url: w.id,
    title: w.title ?? '',
    authors: (w.authorships ?? []).map((a: any) => splitFullName(a.author?.display_name ?? a.raw_author_name ?? '')),
    authorsTruncated: !!w.is_authors_truncated,
    year: w.publication_year,
    years: [w.publication_year].filter(Boolean),
    venue: w.primary_location?.source?.display_name,
    venueAliases: venues,
    venueType: w.primary_location?.source?.type,
    type: w.type,
    doi: w.doi?.replace(/^https?:\/\/doi\.org\//, '').toLowerCase(),
    arxivId: arx,
    volume: w.biblio?.volume,
    issue: w.biblio?.issue,
    pages: w.biblio?.first_page ? `${w.biblio.first_page}${w.biblio.last_page ? '-' + w.biblio.last_page : ''}` : undefined,
    abstract: invertedToText(w.abstract_inverted_index),
    pdfUrl: w.best_oa_location?.pdf_url ?? undefined,
    isRetracted: !!w.is_retracted,
  };
}

export async function openalexSearch(http: Http, title: string, n = 5): Promise<WorkRecord[]> {
  const q = title.replace(/[,:;|!?()[\]{}"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const j = await http.get(`https://api.openalex.org/works?search=${enc(q)}&per_page=${n}&select=${OA_SELECT}`);
  return (j?.results ?? []).map(fromOpenAlex);
}

export async function openalexDoi(http: Http, doi: string): Promise<WorkRecord | null> {
  const j = await http.get(`https://api.openalex.org/works/doi:${enc(doi)}?select=${OA_SELECT}`);
  return j?.id ? fromOpenAlex(j) : null;
}

/* ------------------------------ Semantic Scholar ------------------------------ */

const S2_FIELDS = 'title,year,authors,venue,publicationVenue,externalIds,publicationDate,abstract,openAccessPdf,journal,publicationTypes';

export function fromS2(p: any): WorkRecord {
  const pv = p.publicationVenue;
  return {
    source: 'semanticscholar',
    sourceId: p.paperId,
    url: `https://www.semanticscholar.org/paper/${p.paperId}`,
    title: p.title ?? '',
    authors: (p.authors ?? []).map((a: any) => splitFullName(a.name ?? '')),
    year: p.year ?? undefined,
    years: [p.year, p.publicationDate ? parseInt(p.publicationDate.slice(0, 4), 10) : undefined].filter((x): x is number => !!x),
    venue: p.venue || pv?.name || p.journal?.name,
    venueAliases: [p.venue, pv?.name, ...(pv?.alternate_names ?? []), p.journal?.name].filter(Boolean),
    venueType: pv?.type,
    type: p.publicationTypes?.[0],
    doi: p.externalIds?.DOI?.toLowerCase(),
    arxivId: p.externalIds?.ArXiv,
    volume: /^abs\//i.test(p.journal?.volume ?? '') ? undefined : p.journal?.volume, // S2 stores arXiv ids as 'abs/…'
    pages: p.journal?.pages,
    abstract: p.abstract ?? undefined,
    pdfUrl: p.openAccessPdf?.url || (p.externalIds?.ArXiv ? `https://arxiv.org/pdf/${p.externalIds.ArXiv}` : undefined),
  };
}

export async function s2Match(http: Http, title: string): Promise<WorkRecord[]> {
  const q = title.replace(/[-:]/g, ' ').slice(0, 300);
  const j = await http.get(`https://api.semanticscholar.org/graph/v1/paper/search/match?query=${enc(q)}&fields=${S2_FIELDS}`);
  return (j?.data ?? []).map(fromS2);
}

export async function s2Search(http: Http, q: string, n = 5): Promise<WorkRecord[]> {
  const j = await http.get(`https://api.semanticscholar.org/graph/v1/paper/search?query=${enc(q.replace(/[-:]/g, ' ').slice(0, 300))}&limit=${n}&fields=${S2_FIELDS}`);
  return (j?.data ?? []).map(fromS2);
}

export async function s2Paper(http: Http, id: string): Promise<WorkRecord | null> {
  const j = await http.get(`https://api.semanticscholar.org/graph/v1/paper/${enc(id)}?fields=${S2_FIELDS}`);
  return j?.paperId ? fromS2(j) : null;
}

/* ------------------------------ Europe PMC ------------------------------ */

export function fromEuropePmc(r: any): WorkRecord {
  return {
    source: 'europepmc',
    sourceId: r.id,
    url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
    title: (r.title ?? '').replace(/\.$/, ''),
    authors: (r.authorList?.author ?? []).map((a: any) => (a.lastName ? { family: a.lastName, given: a.firstName ?? a.initials } : splitFullName(a.fullName ?? a.collectiveName ?? ''))),
    year: r.pubYear ? parseInt(r.pubYear, 10) : undefined,
    years: [r.pubYear ? parseInt(r.pubYear, 10) : undefined].filter((x): x is number => !!x),
    venue: r.journalInfo?.journal?.title ?? r.journalTitle,
    venueAliases: [r.journalInfo?.journal?.title, r.journalInfo?.journal?.isoabbreviation, r.journalInfo?.journal?.medlineAbbreviation, r.journalTitle].filter(Boolean),
    venueType: 'journal',
    type: r.pubType,
    doi: r.doi?.toLowerCase(),
    volume: r.journalInfo?.volume,
    issue: r.journalInfo?.issue,
    pages: r.pageInfo,
    abstract: stripTags(r.abstractText),
    isRetracted: /retract/i.test(JSON.stringify(r.pubTypeList ?? '')),
    pdfUrl: r.pmcid ? `https://europepmc.org/articles/${r.pmcid}` : undefined,
  };
}

export async function europePmcSearch(http: Http, title: string, n = 5): Promise<WorkRecord[]> {
  const q = `TITLE:"${title.replace(/["]/g, '').slice(0, 250)}"`;
  const j = await http.get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(q)}&format=json&resultType=core&pageSize=${n}`);
  return (j?.resultList?.result ?? []).map(fromEuropePmc);
}

/** Europe PMC record by DOI (abstract + PMCID for open-access full text). */
export async function europePmcByDoi(http: Http, doi: string): Promise<{ abstract?: string; pmcid?: string; isOA: boolean } | null> {
  const j = await http.get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(`DOI:"${doi}"`)}&format=json&resultType=core&pageSize=1`);
  const r = j?.resultList?.result?.[0];
  if (!r) return null;
  return { abstract: stripTags(r.abstractText), pmcid: r.pmcid, isOA: r.isOpenAccess === 'Y' || r.inPMC === 'Y' };
}

/** Open-access full text (JATS XML) from Europe PMC → body paragraphs as plain text. */
export async function europePmcFullText(http: Http, pmcid: string): Promise<string[] | null> {
  const xml = await http.get<string>(`https://www.ebi.ac.uk/europepmc/webservices/rest/${enc(pmcid)}/fullTextXML`, { as: 'text' });
  if (!xml) return null;
  const body = xml.match(/<body[\s\S]*?<\/body>/)?.[0] ?? '';
  const paras = [...body.matchAll(/<p[\s>][\s\S]*?<\/p>/g)].map((m) =>
    m[0]
      .replace(/<xref[^>]*>[\s\S]*?<\/xref>/g, '') // citation markers
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  return paras.filter((p) => p.length > 40);
}

/* ------------------------------ Software hosts ------------------------------ */

export async function checkSoftwareUrl(http: Http, url: string): Promise<WorkRecord | null | undefined> {
  const gh = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
  if (gh) {
    const repo = gh[2].replace(/\.git$/, '');
    const j = await http.get(`https://api.github.com/repos/${gh[1]}/${repo}`);
    if (!j) return null;
    return {
      source: 'github',
      sourceId: j.full_name,
      url: j.html_url,
      title: `${j.full_name}${j.description ? ': ' + j.description : ''}`,
      authors: [{ family: j.owner?.login ?? gh[1] }],
      year: j.created_at ? parseInt(j.created_at.slice(0, 4), 10) : undefined,
      years: [j.created_at, j.pushed_at].filter(Boolean).map((d: string) => parseInt(d.slice(0, 4), 10)),
      venue: 'GitHub',
      venueAliases: ['GitHub'],
      type: 'software',
    };
  }
  const hf = url.match(/huggingface\.co\/(datasets\/|spaces\/)?([\w.-]+)\/([\w.-]+)/i);
  if (hf) {
    const kind = hf[1] === 'datasets/' ? 'datasets' : hf[1] === 'spaces/' ? 'spaces' : 'models';
    const j = await http.get(`https://huggingface.co/api/${kind}/${hf[2]}/${hf[3]}`);
    if (!j) return null;
    return {
      source: 'huggingface',
      sourceId: j.id,
      url: `https://huggingface.co/${kind === 'models' ? '' : kind + '/'}${j.id}`,
      title: j.id,
      authors: [{ family: j.author ?? hf[2] }],
      year: j.createdAt ? parseInt(j.createdAt.slice(0, 4), 10) : undefined,
      years: j.createdAt ? [parseInt(j.createdAt.slice(0, 4), 10)] : [],
      venue: 'Hugging Face',
      venueAliases: ['Hugging Face'],
      type: kind === 'datasets' ? 'dataset' : 'software',
    };
  }
  return undefined; // not a checkable host
}
