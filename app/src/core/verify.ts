/**
 * Reference verification: multi-source candidate retrieval + field-level alignment.
 * Each candidate record is aligned back onto the raw reference string, so verification
 * does not depend on a perfect parse.
 */
import type { Http } from './http';
import { authorLikeness, parseAuthors, parseReference } from './parse';
import {
  arxivRecord,
  checkSoftwareUrl,
  crossrefBibliographic,
  crossrefDoi,
  crossrefUpdates,
  dataciteDoi,
  europePmcSearch,
  openalexDoi,
  openalexSearch,
  s2Match,
  s2Paper,
  s2Search,
} from './sources';
import { contentTokens, fold, foldName, fuzzyFind, nameSim, ratio, titleSim, tokens } from './text';
import type { FieldCheck, ParsedRef, Person, RefResult, SourceName, Verdict, WorkRecord } from './types';

/* ------------------------------ venues ------------------------------ */

const VENUE_CANON: [string, RegExp][] = [
  ['NeurIPS', /\bneurips\b|\bnips\b|neural information processing systems/],
  ['ICLR', /\biclr\b|international conference on learning representations/],
  ['ICML', /\bicml\b|international conference on machine learning/],
  ['EMNLP', /\bemnlp\b|empirical methods in natural language processing/],
  ['NAACL', /\bnaacl\b|north american chapter of the association for computational linguistics/],
  ['EACL', /\beacl\b|european chapter of the association for computational linguistics/],
  ['AACL', /\baacl\b|asia[- ]pacific chapter of the association for computational linguistics|ijcnlp/],
  ['TACL', /\btacl\b|transactions of the association for computational linguistics/],
  ['ACL', /\bacl\b(?![- ]?(?:anthology|rolling))|annual meeting of the association for computational linguistics/],
  ['COLING', /\bcoling\b|international conference on computational linguistics/],
  ['CVPR', /\bcvpr\b|computer vision and pattern recognition/],
  ['ICCV', /\biccv\b|international conference on computer vision/],
  ['ECCV', /\beccv\b|european conference on computer vision/],
  ['AAAI', /\baaai\b/],
  ['IJCAI', /\bijcai\b|international joint conference on artificial intelligence/],
  ['UAI', /\buai\b|uncertainty in artificial intelligence/],
  ['AISTATS', /\baistats\b|artificial intelligence and statistics/],
  ['KDD', /\bkdd\b|knowledge discovery and data mining/],
  ['SIGIR', /\bsigir\b/],
  ['CHI', /\bchi\b|human factors in computing systems/],
  ['WWW', /\bwww\b|the web conference|world wide web conference/],
  ['JMLR', /\bjmlr\b|journal of machine learning research/],
  ['TMLR', /\btmlr\b|transactions on machine learning research/],
  ['COLM', /\bcolm\b|conference on language modeling/],
  ['CoRL', /\bcorl\b|conference on robot learning/],
  ['ICRA', /\bicra\b|international conference on robotics and automation/],
  ['INTERSPEECH', /interspeech/],
  ['ICASSP', /\bicassp\b|acoustics,? speech,? and signal processing/],
];

function canonVenues(...texts: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    const f = ' ' + fold(t) + ' ';
    for (const [name, re] of VENUE_CANON) {
      if (re.test(f)) {
        out.add(name);
        // "Findings of ACL: EMNLP 2021" / "ACL Workshop"; NAACL strings contain no ACL token by construction
      }
    }
    // ACL main-venue regex also matches inside the long NAACL/EACL/TACL names; remove the overlap
    if (out.has('ACL') && /north american chapter|european chapter|asia pacific chapter|transactions of the association/.test(f) && !/annual meeting/.test(f)) out.delete('ACL');
  }
  return out;
}

const PREPRINT_RE = /arxiv|corr|biorxiv|medrxiv|ssrn|preprint|research square|openreview|techrxiv|chemrxiv|psyarxiv|zenodo/i;

/* ------------------------------ authors ------------------------------ */

interface AuthorAlign {
  cited: Person[];
  matched: number;
  unmatched: Person[];
  givenMismatch: number;
  firstOk: boolean;
  omitted: number; // record authors not cited (when no et al.)
  score: number; // 0..1
}

function familyMatch(c: Person, r: Person): number {
  const cf = foldName(c.family);
  if (!cf) return 0;
  const rf = foldName(r.family);
  const rg = foldName(r.given ?? '');
  let s = nameSim(cf, rf);
  // name order swapped / full name in family field
  if (rg) s = Math.max(s, nameSim(cf, rg) * 0.95);
  const full = foldName(`${r.given ?? ''}${r.family}`);
  if (cf.length >= 5 && full.includes(cf)) s = Math.max(s, 0.95);
  // compound / hyphenated surnames: "Opsahl-Ong" vs "Ong"; "Hatfield Dodds" vs "Hatfield-Dodds"
  if (cf.length >= 3 && rf.length >= 3 && (rf.endsWith(cf) || cf.endsWith(rf) || rf.startsWith(cf) || cf.startsWith(rf))) s = Math.max(s, 0.9);
  return s;
}

function givenCompatible(c: Person, r: Person): boolean {
  if (!c.given || !r.given) return true;
  const ci = fold(c.given).replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
  const ri = fold(r.given).replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
  if (!ci.length || !ri.length) return true;
  if (ci[0][0] !== ri[0][0]) return false;
  if (ci[0].length > 2 && ri[0].length > 2 && ratio(ci[0], ri[0]) < 0.6 && !ri[0].startsWith(ci[0]) && !ci[0].startsWith(ri[0])) return false;
  return true;
}

function isGroupName(r: Person): boolean {
  // Crossref splits "G4.19 Research Group" into given/family, so test the full name
  const full = `${r.given ?? ''} ${r.family}`;
  if (/\b(?:group|team|consortium|committee|collaboration|lab|laboratory|network|initiative|project|working|society)\b/i.test(full) || /\d/.test(full)) return true;
  return !r.given && r.family.trim().split(/\s+/).length >= 3;
}

function isOrgAuthor(c: Person, title?: string): boolean {
  if (c.given) return false;
  const f = c.family.trim();
  if (/\s/.test(f) && !/\b(?:team|group|consortium|corporation|inc|ltd|foundation|institute|commission|organization|organisation|committee|association)\b/i.test(f)) return false;
  return /^[A-Z0-9]{2,}$/.test(f) || /[a-z][A-Z]/.test(f) || /@/.test(f) || /\b(?:team|group|consortium|corporation|inc|ltd|foundation|institute|commission|organization|organisation|committee|association)\b/i.test(f) || (!!title && fold(title).includes(fold(f)));
}

function alignAuthors(cited: Person[], etAl: boolean, rec: WorkRecord): AuthorAlign {
  const R = rec.authors.filter((a) => a.family);
  // a sole organization author ("OpenCitations", "Microsoft Corporation") cannot be compared to people
  if (cited.length === 1 && isOrgAuthor(cited[0], rec.title)) return { cited: [], matched: 0, unmatched: [], givenMismatch: 0, firstOk: true, omitted: 0, score: 0.5 };
  const used = new Set<number>();
  let matched = 0;
  let givenMismatch = 0;
  const unmatched: Person[] = [];
  let firstOk = cited.length === 0;
  cited.forEach((c, ci) => {
    let best = -1;
    let bs = 0;
    R.forEach((r, ri) => {
      if (used.has(ri)) return;
      const s = familyMatch(c, r);
      if (s > bs) {
        bs = s;
        best = ri;
      }
    });
    const thr = foldName(c.family).length <= 3 ? 0.99 : foldName(c.family).length <= 5 ? 0.79 : 0.74;
    if (best >= 0 && bs >= thr) {
      used.add(best);
      matched++;
      if (!givenCompatible(c, R[best])) givenMismatch++;
      if (ci === 0 && best <= 1) firstOk = true;
    } else {
      // organization / consortium authors ("OpenAI", "Gemma Team", "AI@Meta") are never counted against
      if ((/^(?:openai|gemma|meta|google|deepmind|microsoft|team|ai@meta|anthropic|mistral|qwen|the)$/i.test(c.family) || isOrgAuthor(c)) && ci === 0) {
        firstOk = true;
        return;
      }
      // a given name split off as its own "author" ("sarin, parth" → Parth Sarin)
      const cf = foldName(c.family);
      if (!c.given && R.some((r, ri) => used.has(ri) && !!r.given && fold(r.given).split(' ').some((g) => g.length > 2 && nameSim(g, cf) >= 0.9))) return;
      unmatched.push(c);
    }
  });
  if (!R.length) return { cited, matched: 0, unmatched: [], givenMismatch: 0, firstOk: true, omitted: 0, score: 0.5 };
  const people = R.filter((r, ri) => used.has(ri) || !isGroupName(r));
  const omitted = etAl || rec.authorsTruncated ? 0 : Math.max(0, people.length - used.size);
  const denom = Math.max(1, cited.length);
  const score = cited.length ? matched / denom : 0.5;
  return { cited, matched, unmatched, givenMismatch, firstOk, omitted, score };
}

/* ------------------------------ alignment ------------------------------ */

export interface Alignment {
  rec: WorkRecord;
  title: number;
  titleSpan?: { start: number; end: number };
  authors: AuthorAlign;
  yearDiff: number | null;
  venueConflict: boolean;
  venueNote?: string;
  overall: number;
}

function citedAuthorsFor(p: ParsedRef, rec: WorkRecord, span?: { start: number; end: number }): { authors: Person[]; etAl: boolean } {
  // When the parse found no authors but we located the title, authors are the text before it.
  if (p.authors.length || !span || span.start <= 0) return { authors: p.authors, etAl: p.etAl };
  const toks = tokens(p.clean);
  void toks;
  // map token index back to raw text: rebuild by searching for the first title words
  const firstWords = tokens(rec.title).slice(0, 3).join(' ');
  const idx = fold(p.clean).indexOf(firstWords);
  if (idx <= 0) return { authors: p.authors, etAl: p.etAl };
  // approximate raw offset by proportion of folded length
  const raw = p.clean;
  const approx = Math.round((idx / fold(raw).length) * raw.length);
  const prefix = raw.slice(0, approx).replace(/[“"‘(]\s*$/, '').replace(/\(\s*\d{4}[a-z]?\)\.?\s*$/, '');
  return parseAuthors(prefix.replace(/[.,:;\s]+$/, ''));
}

export function align(p: ParsedRef, rec: WorkRecord): Alignment {
  const t1 = p.title ? titleSim(p.title, rec.title) : 0;
  const ff = fuzzyFind(rec.title, p.clean);
  // a short candidate title should not "match" by being a substring of a long cited title
  // A short candidate title must not "match" by being a substring of a longer cited title,
  // and a proceedings/series title must not match the cited *venue*.
  const recLen = tokens(rec.title).length;
  const lenPenalty = p.title && recLen <= 4 ? Math.min(1, recLen / Math.max(1, tokens(p.title).length) + 0.25) : 1;
  let ffScore = ff.score * lenPenalty;
  // (only when the parse is trustworthy: a 'title' that is really an author list means the split failed)
  if (ffScore > t1 && p.venue && p.title && authorLikeness(p.title) < 0.5 && fuzzyFind(rec.title, p.venue).score >= ff.score - 0.03) ffScore = 0;
  const title = Math.max(t1, ffScore);
  const { authors: citedAuthors, etAl } = citedAuthorsFor(p, rec, ff.score > 0.85 ? ff : undefined);
  const authors = alignAuthors(citedAuthors, etAl, rec);
  let yearDiff: number | null = null;
  if (p.year && rec.years.length) yearDiff = Math.min(...rec.years.map((y) => Math.abs(y - p.year!)));
  const citedV = canonVenues(p.venue, p.raw.replace(p.title ?? '', ''));
  const recV = canonVenues(rec.venue, ...rec.venueAliases);
  const recIsPreprint = PREPRINT_RE.test([rec.venue, ...rec.venueAliases].join(' ')) || !rec.venue;
  let venueConflict = false;
  let venueNote: string | undefined;
  if (citedV.size && recV.size && ![...citedV].some((v) => recV.has(v)) && !recIsPreprint) {
    venueConflict = true;
    venueNote = `cited as ${[...citedV].join('/')}, published in ${[...recV].join('/')}`;
  }
  const yearScore = yearDiff === null ? 0.5 : yearDiff === 0 ? 1 : yearDiff === 1 ? 0.8 : yearDiff === 2 ? 0.4 : 0;
  const overall = title * 0.62 + authors.score * 0.28 + yearScore * 0.1;
  return { rec, title, titleSpan: ff.score > 0.85 ? ff : undefined, authors, yearDiff, venueConflict, venueNote, overall };
}

/* ------------------------------ retrieval ------------------------------ */

export interface VerifyContext {
  http: Http;
  /** sources to use for searching (default all) */
  sources?: SourceName[];
  checkRetractions?: boolean;
  log?: (msg: string) => void;
  /** per-reference time budget; once spent, remaining lookups are skipped and reported as unavailable */
  budgetMs?: number;
}

async function safe<T>(name: SourceName, fn: () => Promise<T>, failed: Set<SourceName>, queried: Set<SourceName>, until = Infinity): Promise<T | null> {
  queried.add(name);
  const left = until - Date.now();
  if (left <= 0) {
    failed.add(name);
    return null;
  }
  try {
    const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('time budget')), Math.min(left, 2 ** 31 - 1)));
    return await Promise.race([fn(), timer]);
  } catch {
    failed.add(name);
    return null;
  }
}

function dedupe(recs: WorkRecord[]): WorkRecord[] {
  const seen = new Set<string>();
  const out: WorkRecord[] = [];
  for (const r of recs) {
    if (!r.title) continue;
    // containers (a whole proceedings volume, journal issue, series) are never what a reference cites
    if (/^(?:proceedings|journal-issue|journal-volume|journal|proceedings-series|book-series|book-set|report-series)$/i.test(r.type ?? '')) continue;
    if (/^(?:front matter|back matter|table of contents|cover|index|editorial board)$/i.test(r.venue ?? '') && r.source === 'crossref') continue;
    const k = r.source + ':' + (r.doi ?? r.sourceId);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/* ------------------------------ main ------------------------------ */

export async function verifyReference(input: string | ParsedRef, ctx: VerifyContext, index = 0): Promise<RefResult> {
  const p = typeof input === 'string' ? parseReference(input) : input;
  const http = ctx.http;
  const until = ctx.budgetMs ? Date.now() + ctx.budgetMs : Infinity;
  const failed = new Set<SourceName>();
  const queried = new Set<SourceName>();
  const use = new Set<SourceName>(ctx.sources ?? ['crossref', 'openalex', 'semanticscholar', 'datacite', 'europepmc', 'github', 'huggingface']);
  const issues: string[] = [];
  const checks: FieldCheck[] = [];

  /* 1. identifier records */
  const idRecs: { id: string; rec: WorkRecord | null }[] = [];
  const idJobs: Promise<void>[] = [];
  for (const doi of p.dois.slice(0, 2)) {
    idJobs.push(
      (async () => {
        let rec = await safe('crossref', () => crossrefDoi(http, doi), failed, queried, until);
        if (!rec) rec = await safe('datacite', () => dataciteDoi(http, doi), failed, queried, until);
        if (!rec && use.has('openalex')) rec = await safe('openalex', () => openalexDoi(http, doi), failed, queried, until);
        idRecs.push({ id: `doi:${doi}`, rec });
      })(),
    );
  }
  for (const ax of p.arxivIds.slice(0, 2)) {
    idJobs.push(
      (async () => {
        const rec = await safe('datacite', () => arxivRecord(http, ax), failed, queried, until);
        idRecs.push({ id: `arXiv:${ax}`, rec });
      })(),
    );
  }

  /* 2. search candidates, tier A: Crossref (fast, reliable) alongside identifier lookups */
  const q = p.title && p.title.length > 12 ? p.title : p.clean.slice(0, 250);
  const searchJobs: Promise<WorkRecord[] | null>[] = [];
  const nonScholarly = p.kind === 'web' || p.kind === 'software';
  if (use.has('crossref')) searchJobs.push(safe('crossref', () => crossrefBibliographic(http, p.clean.replace(/https?:\/\/\S+/g, ''), 5), failed, queried, until));
  let software: WorkRecord | null | undefined;
  const swJob = (async () => {
    for (const u of p.urls) {
      if (!use.has('github') && /github/.test(u)) continue;
      const r = await safe(/github/.test(u) ? 'github' : 'huggingface', () => checkSoftwareUrl(http, u), failed, queried, until);
      if (r !== undefined) {
        software = r;
        return;
      }
    }
  })();

  await Promise.all([...idJobs, swJob]);
  let cands = dedupe([...(await Promise.all(searchJobs)).flat().filter((x): x is WorkRecord => !!x), ...idRecs.map((x) => x.rec).filter((x): x is WorkRecord => !!x)]);

  let aligned = cands.map((c) => align(p, c)).sort((a, b) => b.overall - a.overall);
  let best = pickBest(aligned);

  /* tier B: rate-limited indexes, only when tier A did not settle the reference */
  const citedConf = canonVenues(p.venue, p.raw).size > 0;
  const settled =
    !!best &&
    best.title >= 0.92 &&
    best.authors.unmatched.length === 0 &&
    best.authors.firstOk &&
    (best.yearDiff ?? 0) <= 1;
  if (!settled && (!nonScholarly || !p.urls.length || !software)) {
    const tierB: Promise<WorkRecord[] | null>[] = [];
    if (use.has('semanticscholar')) tierB.push(safe('semanticscholar', () => s2Match(http, q), failed, queried, until));
    if (use.has('openalex')) tierB.push(safe('openalex', () => openalexSearch(http, q, 5), failed, queried, until));
    const more = (await Promise.all(tierB)).flat().filter((x): x is WorkRecord => !!x);
    cands = dedupe([...cands, ...more]);
    aligned = cands.map((c) => align(p, c)).sort((a, b) => b.overall - a.overall);
    best = pickBest(aligned);
  }

  /* 2b. second-chance retrieval when nothing matched well */
  if (!best || best.title < 0.85) {
    const extra: Promise<WorkRecord[] | null>[] = [];
    if (use.has('semanticscholar')) extra.push(safe('semanticscholar', () => s2Search(http, q, 5), failed, queried, until));
    // the parsed title may be wrong: also search with the whole reference string
    if (use.has('openalex') && q !== p.clean.slice(0, 250)) extra.push(safe('openalex', () => openalexSearch(http, p.clean.replace(/https?:\/\/\S+/g, '').slice(0, 250), 5), failed, queried, until));
    if (use.has('europepmc') && p.title) extra.push(safe('europepmc', () => europePmcSearch(http, p.title!, 5), failed, queried, until));
    if (use.has('crossref') && p.title) extra.push(safe('crossref', () => crossrefBibliographic(http, p.title!, 5), failed, queried, until));
    const more = (await Promise.all(extra)).flat().filter((x): x is WorkRecord => !!x);
    cands = dedupe([...cands, ...more]);
    aligned = cands.map((c) => align(p, c)).sort((a, b) => b.overall - a.overall);
    best = pickBest(aligned);
  }

  /* 2c. enrich: a strong match from Crossref/DataCite lacks venue aliases for ML conferences → ask S2 by id */
  const citedPub = !!p.venue && !PREPRINT_RE.test(p.venue) && (citedConf || /proceedings|journal|transactions|conference|symposium|workshop|meeting|congress|letters|review/i.test(p.venue));
  const needVenue = citedPub && best && canonVenues(best.rec.venue, ...best.rec.venueAliases).size === 0 && (!best.rec.venue || PREPRINT_RE.test(best.rec.venue));
  if (best && best.title >= 0.85 && use.has('semanticscholar') && needVenue && !aligned.some((a) => a.rec.source === 'semanticscholar' && a.title >= 0.85)) {
    const id = best.rec.arxivId ? `arXiv:${best.rec.arxivId}` : best.rec.doi ? `DOI:${best.rec.doi}` : null;
    if (id) {
      const r = await safe('semanticscholar', () => s2Paper(http, id), failed, queried, until);
      if (r) {
        cands.push(r);
        aligned = cands.map((c) => align(p, c)).sort((a, b) => b.overall - a.overall);
        best = pickBest(aligned);
      }
    }
  }

  /* 3. decide */
  let verdict: Verdict;
  let confidence: number;
  const all = aligned.map((a) => a.rec);

  // identifier consistency
  const idProblems: string[] = [];
  let renamed: WorkRecord | undefined;
  for (const { id, rec } of idRecs) {
    if (!rec) {
      if (!failed.has('crossref') || !failed.has('datacite')) idProblems.push(`${id} does not resolve to any record`);
      checks.push({ field: 'identifier', status: 'mismatch', cited: id, note: 'identifier not found' });
      continue;
    }
    const a = align(p, rec);
    const tOk = a.title >= 0.8;
    const aOk = a.authors.cited.length === 0 || a.authors.score >= 0.5;
    const sameAuthors = a.authors.cited.length >= 1 && a.authors.score >= 0.8 && a.authors.firstOk && a.authors.unmatched.length === 0;
    // a genuine retitling keeps the year and much of the wording; a chimeric citation (fabricated title
    // attached to the authors' real arXiv ID) usually does not
    const yearOk = !p.year || rec.years.some((y) => Math.abs(y - p.year!) <= 1);
    const ct = new Set(contentTokens(p.title ?? ''));
    const rt = contentTokens(rec.title);
    const overlap = rt.filter((t) => ct.has(t)).length / Math.max(1, Math.min(ct.size, rt.length));
    if (!tOk && sameAuthors && /arxiv/i.test(id) && yearOk && overlap >= 0.34) {
      // arXiv titles change between versions; the identifier's current record has the same authors
      checks.push({ field: 'identifier', status: 'minor', cited: id, found: rec.title, note: 'same authors; the arXiv entry was likely retitled in a later version' });
      issues.push(`${id} now carries the title “${rec.title}” (same authors; likely a renamed version)`);
      renamed = rec;
      continue;
    }
    if (!tOk && !(p.title === undefined && aOk)) {
      idProblems.push(`${id} points to a different work: “${rec.title}”`);
      checks.push({ field: 'identifier', status: 'mismatch', cited: id, found: rec.title, note: 'identifier resolves to a different work' });
    } else {
      checks.push({ field: 'identifier', status: 'match', cited: id, found: rec.doi ?? rec.arxivId });
    }
  }

  if (best && best.title >= 0.85) {
    const a = best;
    const r = a.rec;
    let major = 0;
    let minor = 0;
    // title
    const td = p.title && titleSim(p.title, r.title) >= 0.85 ? titleDiff(p.title, r.title) : null;
    if (td && td.kind === 'word') {
      major++;
      issues.push(`Title differs from the published title (${td.words.join(', ')})`);
      checks.unshift({ field: 'title', status: 'mismatch', cited: p.title, found: r.title, score: a.title, note: `words differ: ${td.words.join(', ')}` });
    } else {
      const ok = (a.title >= 0.95 || (!!td && td.kind !== 'word')) && td?.kind !== 'omission';
      checks.unshift({ field: 'title', status: ok ? 'match' : 'minor', cited: p.title, found: r.title, score: a.title, note: td?.kind === 'subtitle' ? 'subtitle differs' : td?.kind === 'omission' ? td.words[0] : undefined });
      if (!ok) minor++;
    }
    // authors
    const au = a.authors;
    const citedN = au.cited.length;
    if (citedN && r.authors.length) {
      const um = au.unmatched.length;
      const recPeople = r.authors.filter((x) => !isGroupName(x)).length;
      // every record author is cited, and the extra cited names come after them: the index truncated its list
      const lastMatchedPos = Math.max(-1, ...au.cited.map((c, k) => (au.unmatched.includes(c) ? -1 : k)));
      const extrasTrail = au.unmatched.every((c) => au.cited.indexOf(c) > lastMatchedPos);
      const recordIncomplete = au.matched >= recPeople && au.firstOk && um <= 3 && extrasTrail && recPeople >= 1;
      const authorMajor = !recordIncomplete && (um >= 2 || (um === 1 && (citedN <= 5 || !au.firstOk)) || (!au.firstOk && citedN >= 1 && au.matched === 0));
      if (authorMajor) {
        major++;
        issues.push(`Author list does not match the published work: ${au.unmatched.map((x) => x.family).join(', ') || 'first author'} not among its authors`);
        checks.push({ field: 'authors', status: 'mismatch', cited: au.cited.map((x) => x.family).join(', '), found: r.authors.slice(0, 8).map((x) => x.family).join(', ') + (r.authors.length > 8 ? ', …' : ''), note: `${um} cited author(s) not on the paper` });
      } else if ((au.omitted >= 2 || (au.omitted >= 1 && au.omitted / r.authors.length >= 0.25)) && citedN < r.authors.length && r.authors.length <= 10 && !r.authorsTruncated && !p.etAl) {
        major++;
        issues.push(`Incomplete author list: ${au.omitted} of ${r.authors.length} authors omitted without “et al.”`);
        checks.push({ field: 'authors', status: 'mismatch', cited: au.cited.map((x) => x.family).join(', '), found: r.authors.slice(0, 8).map((x) => x.family).join(', ') + (r.authors.length > 8 ? ', …' : ''), note: `${au.omitted} author(s) omitted` });
      } else if (um >= 1 || au.givenMismatch > 0 || au.omitted >= 1) {
        minor++;
        const why = recordIncomplete && um ? `the index lists only ${recPeople} author(s); ${au.unmatched.map((x) => x.family).join(', ')} could not be confirmed` : um === 1 ? `“${au.unmatched[0].family}” not found (typo?)` : au.givenMismatch ? 'given-name differences' : `${au.omitted} author(s) omitted without “et al.”`;
        checks.push({ field: 'authors', status: 'minor', cited: au.cited.map((x) => x.family).join(', '), found: r.authors.slice(0, 8).map((x) => x.family).join(', '), note: why });
      } else checks.push({ field: 'authors', status: 'match', cited: au.cited.map((x) => x.family).join(', '), found: r.authors.slice(0, 8).map((x) => x.family).join(', ') });
    } else checks.push({ field: 'authors', status: 'na' });
    // year: the closest year among all records of this work (preprint and published versions)
    const sameWork = aligned.filter((x) => x.title >= 0.85 && x.authors.score >= 0.5 && x.yearDiff !== null);
    if (sameWork.length) a.yearDiff = Math.min(a.yearDiff ?? 99, ...sameWork.map((x) => x.yearDiff!));
    if (a.yearDiff !== null) {
      const onlyPreprints = aligned.filter((x) => x.title >= 0.85).every((x) => !x.rec.venue || PREPRINT_RE.test(x.rec.venue) || x.rec.source === 'datacite');
      const tol = onlyPreprints || PREPRINT_RE.test(p.raw) ? 2 : 1;
      if (a.yearDiff > tol) {
        major++;
        issues.push(`Year ${p.year} does not match the published record (${r.years.join('/')})`);
        checks.push({ field: 'year', status: 'mismatch', cited: String(p.year), found: r.years.join('/') });
      } else checks.push({ field: 'year', status: a.yearDiff === 0 ? 'match' : 'minor', cited: String(p.year), found: r.years.join('/') });
    }
    // venue
    if (a.venueConflict) {
      major++;
      issues.push(`Venue mismatch: ${a.venueNote}`);
      checks.push({ field: 'venue', status: 'mismatch', cited: p.venue, found: r.venue, note: a.venueNote });
    } else {
      const vj = venueGeneralCheck(p, aligned.filter((x) => x.title >= 0.85 && x.authors.score >= 0.5).map((x) => x.rec).concat([r]));
      if (vj === 'mismatch') {
        major++;
        issues.push(`Published in “${r.venue}”, not “${p.venue}”`);
        checks.push({ field: 'venue', status: 'mismatch', cited: p.venue, found: r.venue });
      } else if (p.venue && r.venue) checks.push({ field: 'venue', status: vj === 'match' ? 'match' : 'na', cited: p.venue, found: r.venue });
    }
    // volume / pages
    const pv = pagesCheck(p, r);
    if (pv) {
      if (pv.status === 'mismatch') {
        major++;
        issues.push(pv.note!);
      } else minor++;
      checks.push(pv);
    }
    // identifiers
    if (idProblems.length) {
      major++;
      issues.push(...idProblems);
    }

    // publication status: cited as published in a venue, but every matching record is a preprint
    const citedPublished = !!p.venue && !PREPRINT_RE.test(p.venue) && (canonVenues(p.venue).size > 0 || /proceedings|journal|transactions|conference|symposium|workshop|meeting|congress|letters|review/i.test(p.venue));
    const strongRecs = aligned.filter((x) => x.title >= 0.85 && x.authors.score >= 0.5);
    const anyPublished = strongRecs.some((x) => (x.rec.venue && !PREPRINT_RE.test(x.rec.venue)) || canonVenues(x.rec.venue, ...x.rec.venueAliases).size > 0);
    const anyPreprint = strongRecs.some((x) => PREPRINT_RE.test([x.rec.venue ?? '', ...x.rec.venueAliases].join(' ')) || x.rec.source === 'datacite');
    // a broad index that knows the work but lists no venue means "unknown", not "preprint only"
    const venueUnknown = strongRecs.some((x) => (x.rec.source === 'semanticscholar' || x.rec.source === 'openalex' || x.rec.source === 'crossref') && !x.rec.venue);
    const s2orOaAnswered = (queried.has('semanticscholar') && !failed.has('semanticscholar')) || (queried.has('openalex') && !failed.has('openalex'));
    if (citedPublished && strongRecs.length && !anyPublished && anyPreprint && !venueUnknown && s2orOaAnswered && !a.venueConflict) {
      major++;
      issues.push(`Only a preprint was found; publication in “${p.venue}” could not be confirmed`);
      checks.push({ field: 'venue', status: 'mismatch', cited: p.venue, found: r.venue ?? 'preprint', note: 'publication status unconfirmed' });
    }

    if (idProblems.some((x) => x.includes('different work'))) verdict = 'id_mismatch';
    else verdict = major ? 'metadata_error' : minor ? 'verified_minor' : 'verified';
    confidence = major ? 0.35 : Math.min(0.99, 0.6 + a.title * 0.25 + a.authors.score * 0.14);

    // a same-titled scholarly record by other authors does not disprove a cited web page / dataset / tool
    const webUrl = p.urls.some((u) => !/doi\.org|arxiv\.org/i.test(u));
    if (verdict === 'metadata_error' && webUrl && (p.kind === 'web' || p.kind === 'dataset' || p.kind === 'software')) {
      verdict = 'unverifiable';
      confidence = 0.5;
      issues.length = 0;
      issues.push(`${kindLabel(p.kind)}: a different work with the same title is indexed; check the linked page manually`);
    }
  } else if (idProblems.some((x) => x.includes('different work'))) {
    verdict = 'id_mismatch';
    confidence = 0.1;
    issues.push(...idProblems);
  } else {
    // nothing matched by title
    const partial = aligned.find((a) => a.title >= 0.6 && a.authors.score >= 0.6 && (a.yearDiff ?? 9) <= 1);
    if (renamed) {
      // the cited (older) title survives only in an earlier arXiv version; same identifier, same authors
      verdict = 'verified_minor';
      confidence = 0.75;
      best = align(p, renamed);
    } else if (software) {
      verdict = 'verified';
      confidence = 0.85;
      checks.push({ field: 'identifier', status: 'match', cited: p.urls[0], found: software.url, note: `${software.source} ${software.type} exists` });
      best = align(p, software);
    } else if (software === null) {
      verdict = 'not_found';
      confidence = 0.2;
      issues.push(`Linked resource ${p.urls[0]} does not exist`);
    } else if (p.placeholders.length) {
      verdict = 'fabricated';
      confidence = 0.02;
      issues.push(`Template / placeholder content: ${p.placeholders.join(', ')}`);
    } else if (partial) {
      verdict = 'metadata_error';
      confidence = 0.3;
      best = partial;
      issues.push(`Closest real work has a different title: “${partial.rec.title}”`);
      checks.push({ field: 'title', status: 'mismatch', cited: p.title, found: partial.rec.title, score: partial.title });
    } else if (p.kind === 'web' || p.kind === 'software' || p.kind === 'dataset' || p.kind === 'report' || p.kind === 'book' || p.kind === 'thesis') {
      verdict = 'unverifiable';
      confidence = 0.5;
      issues.push(`${kindLabel(p.kind)}: not indexed by scholarly databases; check manually`);
      best = undefined;
    } else if (p.dois.length && idProblems.length) {
      verdict = 'not_found';
      confidence = 0.1;
      issues.push(...idProblems);
    } else {
      const answered = [...queried].filter((s) => !failed.has(s));
      if (answered.length === 0) {
        verdict = 'not_found';
        confidence = 0.5;
        issues.push('Scholarly indexes unavailable; could not check');
      } else {
        // only call it fabricated when the broad-coverage indexes actually answered
        const majorDown = ['semanticscholar', 'openalex'].filter((s) => queried.has(s as SourceName) && failed.has(s as SourceName));
        const strong = answered.length >= 2 && majorDown.length < 2 && !(majorDown.length && answered.length < 3);
        verdict = strong ? 'fabricated' : 'not_found';
        confidence = strong ? 0.08 : 0.2;
        if (majorDown.length) issues.push(`${majorDown.map((s) => sourceLabel(s as SourceName)).join(' and ')} did not respond; re-run later to confirm`);
        const near = aligned[0];
        issues.push(`No matching work in ${answered.map(sourceLabel).join(', ')}`);
        if (near && near.title >= 0.5) issues.push(`Nearest record: “${near.rec.title}” (${Math.round(near.title * 100)}% title similarity)`);
      }
    }
    if (!best && verdict !== 'unverifiable') best = undefined;
  }

  // placeholder text is decisive even if a related work exists
  if (p.placeholders.length && verdict !== 'fabricated') {
    issues.push(`Template / placeholder content: ${p.placeholders.join(', ')}`);
    if (verdict === 'verified' || verdict === 'verified_minor') verdict = 'metadata_error';
  }
  // weak LLM tell: "Name and et al."
  if (/\band et al\b/i.test(p.raw)) issues.push('“and et al.” pattern (common in machine-generated references)');

  /* 4. retraction */
  const m = best && best.title >= 0.85 ? best.rec : verdict === 'verified' && software ? software : undefined;
  if (m && (verdict === 'verified' || verdict === 'verified_minor' || verdict === 'metadata_error')) {
    let retracted = !!m.isRetracted || aligned.some((a) => a.title >= 0.9 && a.rec.isRetracted && a.authors.score >= 0.5);
    if (!retracted && ctx.checkRetractions !== false && m.doi && use.has('crossref')) {
      const ups = await safe('crossref', () => crossrefUpdates(http, m.doi!), failed, queried, until);
      if (ups?.some((u) => /retract|withdraw|removal/i.test(u.type))) retracted = true;
      else if (ups?.length) issues.push(`Has published ${[...new Set(ups.map((u) => u.type))].join(', ')} notice(s)`);
    }
    if (retracted) {
      verdict = 'retracted';
      confidence = Math.min(confidence, 0.2);
      issues.unshift('This work has been retracted');
    }
  }

  return {
    index,
    parsed: p,
    verdict,
    confidence,
    match: best && (best.title >= 0.6 || verdict === 'verified') ? best.rec : undefined,
    checks,
    issues,
    candidates: all.slice(0, 5),
    sourcesQueried: [...queried],
    sourcesFailed: [...failed],
    suggestedFix: best && best.title >= 0.85 && verdict !== 'verified' ? formatReference(best.rec) : undefined,
  };
}

/** A same-titled record with no author in common and a distant year is a different work (generic titles). */
function differentWork(a: Alignment): boolean {
  return a.authors.cited.length > 0 && a.authors.matched === 0 && (a.yearDiff ?? 0) > 2 && tokens(a.rec.title).length <= 5;
}

function pickBest(aligned: Alignment[]): Alignment | undefined {
  // among strong title matches prefer the best author agreement; prefer published over preprint on ties
  // The question is whether a record exists that matches the reference *as cited*, so among
  // same-title records (re-deposits, preprint vs. published versions) prefer the one that agrees
  // with the most cited fields.
  const strong = aligned.filter((a) => a.title >= 0.85 && !differentWork(a));
  if (!strong.length) return aligned.find((a) => a.title < 0.85) ?? undefined;
  const agree = (a: Alignment) => {
    const y = a.yearDiff === null ? 0.5 : a.yearDiff === 0 ? 1 : a.yearDiff === 1 ? 0.75 : a.yearDiff === 2 ? 0.3 : 0;
    const rich = (a.rec.venueAliases.length > 1 ? 0.05 : 0) + (a.rec.doi || a.rec.arxivId ? 0.05 : 0);
    return a.title * 0.5 + a.authors.score + y * 0.8 - (a.venueConflict ? 0.4 : 0) - a.authors.unmatched.length * 0.1 + rich;
  };
  return strong.sort((a, b) => {
    const s = agree(b) - agree(a);
    if (Math.abs(s) > 0.02) return s;
    const pa = PREPRINT_RE.test(a.rec.venue ?? '') ? 1 : 0;
    const pb = PREPRINT_RE.test(b.rec.venue ?? '') ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return (b.rec.venueAliases.length > 1 ? 1 : 0) - (a.rec.venueAliases.length > 1 ? 1 : 0);
  })[0];
}


/* ------------------------------ title diff ------------------------------ */

const BRIT: [RegExp, string][] = [
  [/our$/, 'or'],
  [/isation(s?)$/, 'ization$1'],
  [/ise(s|d)?$/, 'ize$1'],
  [/ising$/, 'izing'],
  [/yse(s|d)?$/, 'yze$1'],
  [/lling$/, 'ling'],
  [/lled$/, 'led'],
  [/tre$/, 'ter'],
];
function normWord(w: string): string {
  let x = w;
  if (x.length > 5) for (const [re, r] of BRIT) if (re.test(x)) x = x.replace(re, r);
  return x;
}

/** Classify how a cited title differs from the record title. */
export function titleDiff(cited: string, found: string): { kind: 'identical' | 'cosmetic' | 'subtitle' | 'omission' | 'word'; words: string[] } {
  const a = fold(cited);
  const b = fold(found);
  if (a === b) return { kind: 'identical', words: [] };
  if (a.replace(/ /g, '') === b.replace(/ /g, '')) return { kind: 'cosmetic', words: [] };
  // one title is the other plus a subtitle (after a colon or dash)
  if (a.length >= 12 && b.startsWith(a + ' ') && /[:\-–—]/.test(found)) return { kind: 'subtitle', words: [] };
  if (b.length >= 12 && a.startsWith(b + ' ') && /[:\-–—]/.test(cited)) return { kind: 'subtitle', words: [] };
  const A = a.split(' ').filter((t) => t !== 'and').map(normWord);
  const B = b.split(' ').filter((t) => t !== 'and').map(normWord);
  const cnt = new Map<string, number>();
  for (const t of A) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  for (const t of B) cnt.set(t, (cnt.get(t) ?? 0) - 1);
  const plus = [...cnt.entries()].filter(([, v]) => v > 0).map(([t]) => t);
  const minus = [...cnt.entries()].filter(([, v]) => v < 0).map(([t]) => t);
  if (!plus.length && !minus.length) return { kind: 'cosmetic', words: [] };
  // joined/split compounds: "pre training" vs "pretraining"
  if ([...plus].sort().join('') === [...minus].sort().join('') || plus.join('') === minus.join('')) return { kind: 'cosmetic', words: [] };
  // plural/singular only
  if (plus.length === minus.length && plus.every((t) => minus.some((m) => m === t + 's' || t === m + 's' || m === t + 'es' || t === m + 'es'))) return { kind: 'cosmetic', words: [] };
  if (!plus.length && minus.length === 1) return { kind: 'omission', words: [`missing “${minus[0]}”`] };
  if (!plus.length && A.length >= 3 && B.slice(0, A.length).join(' ') === A.join(' ')) return { kind: 'omission', words: ['abbreviated title'] };
  return { kind: 'word', words: [...plus.map((t) => `cited “${t}”`), ...minus.map((t) => `published “${t}”`)].slice(0, 6) };
}

/* ------------------------------ venue (general) ------------------------------ */

const VENUE_STOP = new Set('proceedings proc of the in on and for international intl conference conf annual meeting workshop workshops symposium journal j ieee acm transactions trans advances adv th st nd rd volume vol part series lecture notes computer science lncs findings association new york ny usa pp p pages page no doi url issn isbn publisher en inc press ed eds editors at'.split(' '));

function venueTokens(s: string): string[] {
  return fold(s)
    .split(' ')
    .filter((t) => t && !VENUE_STOP.has(t) && !/^\d+$/.test(t));
}

function initials(s: string): string {
  // initials of the informative words only ("Proceedings on I Can't Believe It's Not Better…" → "icbinb…")
  return venueTokens(s)
    .map((t) => t[0])
    .join('');
}

/** Does the cited venue plausibly name the venue of any of the records (aliases, abbreviations, acronyms)? */
function venueGeneralCheck(p: ParsedRef, recs: WorkRecord[]): 'match' | 'mismatch' | 'unknown' {
  if (!p.venue || PREPRINT_RE.test(p.venue)) return 'unknown';
  // a publisher ("Cambridge University Press", "Springer") is not a venue that can be compared
  if (p.kind === 'book' || /(?:press|publish(?:ers?|ing)|springer|elsevier|wiley|routledge|crc|academic|verlag|sage|mit|university of [a-z]+)/i.test(p.venue) && !/journal|proceedings|transactions|conference/i.test(p.venue)) return 'unknown';
  const names = recs.flatMap((r) => [r.venue, ...r.venueAliases]).filter((x): x is string => !!x && !PREPRINT_RE.test(x) && !/^(?:front matter|unknown)$/i.test(x));
  if (!names.length) return 'unknown';
  const C = venueTokens(p.venue);
  if (!C.length) return 'unknown';
  const citedCanon = canonVenues(p.venue);
  const recCanon = canonVenues(...names);
  if (citedCanon.size && recCanon.size) return [...citedCanon].some((v) => recCanon.has(v)) ? 'match' : 'mismatch';
  const cInit = initials(p.venue);
  const cf = fold(p.venue);
  for (const n of names) {
    const N = venueTokens(n);
    if (!N.length) continue;
    const nf = fold(n);
    // abbreviation-aware coverage ("IEEE Trans. Pattern Anal. Mach. Intell.")
    const covered = C.filter((c) => N.some((t) => t === c || (c.length >= 3 && t.startsWith(c)) || (t.length >= 3 && c.startsWith(t)) || ratio(t, c) >= 0.85)).length;
    if (covered / C.length >= 0.6) return 'match';
    // acronym ↔ long form ("TPAMI", "JMLR", "CVPR")
    const nInit = initials(n);
    if (C.some((c) => c.length >= 3 && (c === nInit || nf.split(' ').includes(c)))) return 'match';
    if (N.some((t) => t.length >= 3 && (t === cInit || (t.length >= 4 && cInit.startsWith(t)) || cf.split(' ').includes(t)))) return 'match';
    if (C.some((c) => c.length >= 4 && nInit.startsWith(c))) return 'match';
  }
  return 'mismatch';
}

function pagesCheck(p: ParsedRef, r: WorkRecord): FieldCheck | null {
  const notes: string[] = [];
  let status: FieldCheck['status'] = 'match';
  // volume and pages are not core identity fields: differences are reported as minor
  if (p.volume && r.volume && p.volume !== r.volume && /^\d+$/.test(r.volume)) {
    notes.push(`volume ${p.volume} vs ${r.volume}`);
    status = 'minor';
  }
  if (p.pages && r.pages) {
    const [cs, ce] = p.pages.split('-').map((x) => parseInt(x, 10));
    const [rs, re] = String(r.pages).split(/[-–]/).map((x) => parseInt(x, 10));
    if (Number.isFinite(cs) && Number.isFinite(rs) && cs !== rs && !(ce && re && ce === re)) {
      notes.push(`pages ${p.pages} vs ${r.pages}`);
      status = 'minor';
    }
  }
  if (!notes.length) return null;
  return { field: 'pages', status, cited: [p.volume, p.pages].filter(Boolean).join(' / '), found: [r.volume, r.pages].filter(Boolean).join(' / '), note: `Bibliographic details differ: ${notes.join('; ')}` };
}

export function kindLabel(k: ParsedRef['kind']): string {
  return { web: 'Web resource', software: 'Software', dataset: 'Dataset', report: 'Technical report', book: 'Book', thesis: 'Thesis', article: 'Article', unknown: 'Reference' }[k];
}

export function sourceLabel(s: SourceName): string {
  return { crossref: 'Crossref', openalex: 'OpenAlex', semanticscholar: 'Semantic Scholar', datacite: 'DataCite', europepmc: 'Europe PMC', github: 'GitHub', huggingface: 'Hugging Face', pubmed: 'PubMed' }[s];
}

export function formatReference(r: WorkRecord): string {
  const au = r.authors.slice(0, 6).map((a) => `${a.family}${a.given ? ', ' + a.given.split(/[\s-]+/).map((g) => g[0] + '.').join(' ') : ''}`);
  const authors = au.length ? (r.authors.length > 6 ? au.join(', ') + ', et al.' : au.length > 1 ? au.slice(0, -1).join(', ') + ', & ' + au[au.length - 1] : au[0]) : '';
  const venue = r.venue && !/^arxiv/i.test(r.venue) ? ` ${r.venue}${r.volume ? `, ${r.volume}` : ''}${r.issue ? `(${r.issue})` : ''}${r.pages ? `, ${r.pages}` : ''}.` : r.arxivId ? ` arXiv:${r.arxivId}.` : '';
  const id = r.doi ? ` https://doi.org/${r.doi}` : r.arxivId ? '' : r.url ? ` ${r.url}` : '';
  return `${authors} (${r.year ?? 'n.d.'}). ${r.title}.${venue}${id}`.replace(/\s+/g, ' ').trim();
}

export function toBibtex(r: WorkRecord, key?: string): string {
  const k = key ?? `${foldName(r.authors[0]?.family ?? 'anon')}${r.year ?? ''}${tokens(r.title).find((t) => t.length > 3) ?? ''}`;
  const type = /journal/.test(r.type ?? '') ? 'article' : /proceedings|conference/.test(r.type ?? '') || r.venueType === 'conference' ? 'inproceedings' : r.arxivId && !r.venue ? 'misc' : 'article';
  const f: [string, string | undefined][] = [
    ['title', `{${r.title}}`],
    ['author', r.authors.map((a) => `${a.family}${a.given ? ', ' + a.given : ''}`).join(' and ')],
    ['year', r.year ? String(r.year) : undefined],
    [type === 'inproceedings' ? 'booktitle' : 'journal', r.venue && !/^arxiv/i.test(r.venue) ? r.venue : undefined],
    ['volume', r.volume],
    ['number', r.issue],
    ['pages', r.pages?.replace(/-/, '--')],
    ['doi', r.doi],
    ['eprint', r.arxivId],
    ['archivePrefix', r.arxivId ? 'arXiv' : undefined],
  ];
  return `@${type}{${k},\n${f
    .filter(([, v]) => v)
    .map(([n, v]) => `  ${n} = {${v}}`)
    .join(',\n')}\n}`;
}
