/**
 * Reference verification: multi-source candidate retrieval + field-level alignment.
 * Each candidate record is aligned back onto the raw reference string, so verification
 * does not depend on a perfect parse.
 */
import type { Http } from './http';
import { authorLikeness, doiAlternatives, parseAuthors, parseReference } from './parse';
import {
  arxivRecord,
  checkSoftwareUrl,
  crossrefBibliographic,
  crossrefDoi,
  crossrefUpdates,
  dataciteDoi,
  doiRegistered,
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
  ['TPAMI', /\btpami\b|\bpami\b|pattern analysis and machine intelligence/],
  ['IJCV', /\bijcv\b|international journal of computer vision/],
  ['TNNLS', /\btnnls\b|transactions on neural networks and learning systems/],
  ['CACM', /\bcacm\b|communications of the acm/],
  // the English translation of Zh. Eksp. Teor. Fiz.: "Soviet Physics JETP", later "Journal of Experimental and Theoretical Physics"
  ['JETP', /\bjetp\b|journal of experimental and theoretical physics|zh eksp teor fiz/],
  // ApJ Letters shares ApJ's volumes (L-prefixed pages) and Crossref files many of its articles under ApJ
  ['ApJ', /\bapjl?\b|\bastrophysical journal\b(?! supplement)|\bastrophys j\b(?! suppl)/],
  ['JHEP', /\bjhep\b|journal of high energy physics/],
];

export function canonVenues(...texts: (string | undefined)[]): Set<string> {
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

const JOURNAL_CANON = new Set(['TPAMI', 'IJCV', 'TNNLS', 'CACM', 'JMLR', 'TMLR', 'TACL', 'JETP', 'ApJ', 'JHEP']);

const PREPRINT_RE = /arxiv|corr|biorxiv|medrxiv|ssrn|preprint|research square|openreview|techrxiv|chemrxiv|psyarxiv|zenodo/i;
/** "Submitted to Phys. Rev. Lett.", "under review at …": the venue names a destination, not a publication */
const NOT_YET_PUBLISHED_RE = /\b(?:submitted (?:to|for)|under (?:review|submission)|accepted (?:for|in|at|by)|to appear)\b/i;
function notYetPublished(p: ParsedRef): boolean {
  if (!p.venue) return false;
  if (NOT_YET_PUBLISHED_RE.test(p.venue)) return true;
  const at = p.raw.indexOf(p.venue);
  return at > 0 && /\b(?:submitted (?:to|for)|under review (?:at|in|for)|accepted (?:for|in|at|by)|to appear in)[\s:]*(?:publication in\s*)?$/i.test(p.raw.slice(Math.max(0, at - 40), at));
}

/* ------------------------------ authors ------------------------------ */

interface AuthorAlign {
  cited: Person[];
  matched: number;
  unmatched: Person[];
  givenMismatch: number;
  firstOk: boolean;
  omitted: number; // record authors not cited (when no et al.)
  missing: Person[]; // those record authors
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
  // "CMS Collaboration", "European Muon Collaboration", "Fermilab E665 Collaboration" (parsed as given + family)
  if (/\b(?:collaboration|consortium)\b/i.test(`${c.given ?? ''} ${c.family}`)) return true;
  if (c.given) return false;
  const f = c.family.trim();
  if (/\s/.test(f) && !/\b(?:team|group|consortium|corporation|inc|ltd|foundation|institute|commission|organization|organisation|committee|association)\b/i.test(f)) return false;
  return /^[A-Z0-9]{2,}$/.test(f) || /[a-z][A-Z]/.test(f) || /@/.test(f) || /\b(?:team|group|consortium|corporation|inc|ltd|foundation|institute|commission|organization|organisation|committee|association)\b/i.test(f) || (!!title && fold(title).includes(fold(f)));
}

function isParseDebris(c: Person, rec: WorkRecord): boolean {
  const f = c.family.trim();
  if (/^(?:arxiv|org|preprint|corr|abs|doi|url|https?|online|available)$/i.test(f)) return true;
  if (!c.given && /^\p{Lu}{1,2}(?:-\p{Lu}{1,2})+\.?$/u.test(f)) return true;
  // title text read as a name: family "channels", given "Measurement of the CKM angle γ using the …"
  if (/^\p{Ll}/u.test(f) && !/^(?:van|von|de|der|den|del|della|di|da|du|dos|le|la|ter|ten|zu|al|el|bin|ibn)\b/.test(f) && (c.given ?? '').split(/\s+/).filter((w) => /^\p{Ll}{3,}/u.test(w)).length >= 2) return true;
  const words = tokens(`${c.given ?? ''} ${f}`).filter((t) => t.length >= 3);
  if (!words.length) return false;
  const pool = new Set(tokens(`${rec.title} ${rec.venue ?? ''} ${(rec.venueAliases ?? []).join(' ')}`));
  return words.every((t) => pool.has(t));
}

/**
 * Repair author entries where the author/title boundary was misplaced. Only fires when the "family name" is
 * clearly not a surname (a lowercase word or two-three letters) or a group label, so ordinary names pass through.
 */
function salvagePerson(c: Person): Person[] {
  const f = c.family.trim();
  const g = (c.given ?? '').trim();
  // a group name ahead of the person list ("LHCb collaboration, R. Aaij et al.")
  if (/^(?:collaborations?|group|consortium)$/i.test(f)) return [];
  // Vancouver initials read as the family name: "Diniz PPVP" → Diniz, P. P. V. P.
  if (/^\p{Lu}{2,4}$/u.test(f) && /^\p{Lu}\p{Ll}[\p{L}'’-]+$/u.test(g)) return [{ family: g, given: f }];
  if ((/^\p{Ll}/u.test(f) || f.length <= 3) && g.split(/\s+/).length >= 2) {
    // last author swallowed the title start: "Anthony T. Patera." (+ "An" ’empirical interpolation’ …)
    const western = g.match(/^((?:\p{Lu}[\p{L}'’-]*\.?\s)+)(\p{Lu}[\p{L}'’-]+)\.$/u);
    if (western) return [{ family: western[2], given: western[1].trim() }];
    // Vancouver: "Råberg L. Co-infection" (+ "with" “Candidatus …”), "Cuschieri S. The STROBE" (+ "guidelines")
    const vancouver = g.match(/^(\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?)\s(\p{Lu}{1,4})\.\s+(?=\p{Lu}?\p{Ll})/u);
    if (vancouver) return [{ family: vancouver[1], given: vancouver[2] }];
  }
  return [c];
}

function alignAuthors(citedIn: Person[], etAl: boolean, rec: WorkRecord): AuthorAlign {
  const cited = citedIn.flatMap(salvagePerson);
  // indexes sometimes list the same person twice ("Nielsen, S. F.; Nielsen, S. F.")
  const seenNames = new Set<string>();
  const R = rec.authors.filter((a) => {
    if (!a.family) return false;
    const k = `${foldName(a.family)}|${fold(a.given ?? '')}`; // exact repeats only: co-authors often share a surname
    if (seenNames.has(k)) return false;
    seenNames.add(k);
    return true;
  });
  // a sole organization author ("OpenCitations", "Microsoft Corporation") cannot be compared to people
  if (cited.length === 1 && isOrgAuthor(cited[0], rec.title)) return { cited: [], matched: 0, unmatched: [], givenMismatch: 0, firstOk: true, omitted: 0, missing: [], score: 0.5 };
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
      // parsing debris, not a person: a split initial ("S-J"), an index label ("arXiv"), or words that all
      // occur in the record's title or venue (the author/title boundary was misplaced)
      if (isParseDebris(c, rec)) return;
      // a given name split off as its own "author" ("sarin, parth" → Parth Sarin)
      const cf = foldName(c.family);
      if (!c.given && R.some((r, ri) => used.has(ri) && !!r.given && fold(r.given).split(' ').some((g) => g.length > 2 && nameSim(g, cf) >= 0.9))) return;
      unmatched.push(c);
    }
  });
  if (!R.length) return { cited, matched: 0, unmatched: [], givenMismatch: 0, firstOk: true, omitted: 0, missing: [], score: 0.5 };
  // the record lists only the first author (common for older Crossref deposits): co-authors cannot be checked
  if (R.length === 1 && cited.length >= 3 && firstOk && matched === 1) return { cited: cited.slice(0, 1), matched: 1, unmatched: [], givenMismatch, firstOk, omitted: 0, missing: [], score: 1 };
  const people = R.filter((r, ri) => used.has(ri) || !isGroupName(r));
  const omitted = etAl || rec.authorsTruncated ? 0 : Math.max(0, people.length - used.size);
  const missing = etAl || rec.authorsTruncated ? [] : R.filter((r, ri) => !used.has(ri) && !isGroupName(r));
  const denom = Math.max(1, cited.length);
  const score = cited.length ? matched / denom : 0.5;
  return { cited, matched, unmatched, givenMismatch, firstOk, omitted, missing, score };
}

/* ------------------------------ alignment ------------------------------ */

function nonLatin(s: string): boolean {
  const letters = s.match(/\p{L}/gu) ?? [];
  const latin = s.match(/\p{Script=Latin}/gu) ?? [];
  return letters.length >= 4 && latin.length / letters.length < 0.5;
}

/** A journal item whose title is the cited book's title: a book review, which proves the book exists but not its details. */
export function isBookReview(p: ParsedRef, rec: WorkRecord): boolean {
  if (p.kind !== 'book') return false;
  const journalItem = /journal-article|^article$|journalarticle|^review$/i.test(rec.type ?? '') || (rec.venueType === 'journal' && !/book/i.test(rec.type ?? ''));
  const first = p.authors[0];
  const byCited = !!first && rec.authors.some((a) => familyMatch(first, a) >= 0.85);
  if (!byCited && first && rec.authors.length && !/book|monograph/i.test(rec.type ?? '') && (!p.year || !rec.year || rec.year >= p.year - 1)) return true;
  if (!journalItem || !rec.venue) return false;
  return !byCited || /\bby\b|\beds?\.|\bpp\.|\bisbn\b|\bpress\b|\(\s*\d{4}\s*\)|\$\s?\d/i.test(rec.title) || rec.authors.length > Math.max(1, p.authors.length);
}

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
  let title = Math.max(t1, ffScore);
  // the DOI's record carries the title in another script (Cyrillic, CJK…), the reference a translation
  if (title < 0.9 && rec.doi && p.dois.includes(rec.doi) && nonLatin(rec.title) && !nonLatin(p.title ?? p.clean)) title = 0.9;
  // another instalment of a series ("The fifth PASCAL … challenge" vs "The third …", "SemEval-2016 Task 4" vs 2017) is a different work
  if (p.title && title < 1 && seriesDiffer(p.title, rec.title)) title = Math.min(title, 0.6);
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
  const lookDoi = async (doi: string) => {
    let rec = await safe('crossref', () => crossrefDoi(http, doi), failed, queried, until);
    if (!rec) rec = await safe('datacite', () => dataciteDoi(http, doi), failed, queried, until);
    if (!rec && use.has('openalex')) rec = await safe('openalex', () => openalexDoi(http, doi), failed, queried, until);
    return rec;
  };
  for (const doi of p.dois.slice(0, 2)) {
    idJobs.push(
      (async () => {
        let rec = await lookDoi(doi);
        let id = doi;
        // PDF line breaks and publisher URLs garble DOIs: try the plausible readings before calling it unresolvable
        if (!rec)
          for (const alt of doiAlternatives(doi, p.raw)) {
            const r2 = await lookDoi(alt);
            if (r2 && align(p, r2).title >= 0.8) {
              rec = r2;
              id = alt;
              break;
            }
          }
        idRecs.push({ id: `doi:${id}`, rec });
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
      const src = /github/.test(u) ? 'github' : 'huggingface';
      let r = await safe(src, () => checkSoftwareUrl(http, u), failed, queried, until);
      if (r === null) {
        // a URL broken at a line end: "…/technical-tim eline"
        const cont = p.raw.slice(p.raw.indexOf(u) + u.length).match(/^\s([a-z0-9][\w.\-/]*?)(?=[.,;]?(?:\s|$))/);
        if (cont) {
          const r2 = await safe(src, () => checkSoftwareUrl(http, u + cont[1]), failed, queried, until);
          if (r2) r = r2;
        }
      }
      if (r !== undefined) {
        software = r;
        return;
      }
    }
  })();

  await Promise.all([...idJobs, swJob]);
  let cands = dedupe([...(await Promise.all(searchJobs)).flat().filter((x): x is WorkRecord => !!x), ...idRecs.map((x) => x.rec).filter((x): x is WorkRecord => !!x)]);

  let aligned = cands.map((c) => align(p, c)).sort((a, b) => b.overall - a.overall);
  let best = pickBest(aligned, p);

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
    best = pickBest(aligned, p);
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
    best = pickBest(aligned, p);
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
        best = pickBest(aligned, p);
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
  const goodDoi = idRecs.some((o) => o.rec && o.id.startsWith('doi:') && align(p, o.rec).title >= 0.8);
  for (const { id, rec } of idRecs) {
    if (!rec) {
      if (goodDoi && id.startsWith('doi:')) continue;
      if (id.startsWith('doi:') && (await safe('crossref', () => doiRegistered(http, id.slice(4)), new Set(), queried, until))) {
        checks.push({ field: 'identifier', status: 'na', cited: id, note: 'registered DOI, but its metadata is not in Crossref or DataCite' });
        continue;
      }
      // a DOI cut at a line break ("10.1103/RevModPhys.87." for "…87.307"): the matched work's DOI extends it
      const cut = id.startsWith('doi:') ? id.slice(4).toLowerCase().replace(/[.\-_/]+$/, '') : '';
      const ext = cut ? aligned.find((x) => x.title >= 0.9 && x.rec.doi && x.rec.doi.toLowerCase().startsWith(cut) && x.rec.doi.length > cut.length) : undefined;
      if (ext) {
        checks.push({ field: 'identifier', status: 'minor', cited: id, found: ext.rec.doi, note: 'DOI appears cut off in the text (line break?)' });
        continue;
      }
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
    // another index still lists the cited title under this very identifier: an earlier version's title
    const otherIndexAgrees = !!rec.arxivId && aligned.some((x) => x.rec !== rec && x.title >= 0.85 && x.rec.arxivId?.replace(/v\d+$/, '') === rec.arxivId!.replace(/v\d+$/, ''));
    if (!tOk && sameAuthors && /arxiv/i.test(id) && yearOk && (overlap >= 0.34 || otherIndexAgrees)) {
      // arXiv titles change between versions; the identifier's current record has the same authors
      checks.push({ field: 'identifier', status: 'minor', cited: id, found: rec.title, note: 'same authors; the arXiv entry was likely retitled in a later version' });
      issues.push(`${id} now carries the title “${rec.title}” (same authors; likely a renamed version)`);
      renamed = rec;
      continue;
    }
    // the record's full title is written in the reference: the title split failed, the identifier is right
    const titleInText = tokens(rec.title).length >= 3 && ` ${fold(p.clean)} `.includes(` ${fold(rec.title)} `) && aOk;
    if (!tOk && !(p.title === undefined && aOk) && !titleInText) {
      idProblems.push(`${id} points to a different work: “${rec.title}”`);
      checks.push({ field: 'identifier', status: 'mismatch', cited: id, found: rec.title, note: 'identifier resolves to a different work' });
    } else {
      checks.push({ field: 'identifier', status: 'match', cited: id, found: rec.doi ?? rec.arxivId });
    }
  }

  const review = !!best && best.title >= 0.85 && isBookReview(p, best.rec);
  if (best && review) {
    const r = best.rec;
    const ry = r.year;
    const plausible = !p.year || !ry || (ry >= p.year - 1 && ry <= p.year + 6) || p.year > ry;
    verdict = plausible ? 'verified_minor' : 'unverifiable';
    confidence = plausible ? 0.75 : 0.5;
    checks.unshift({ field: 'title', status: 'match', cited: p.title, found: r.title, score: best.title, note: `title found in a review of the book (${r.venue}${ry ? ', ' + ry : ''})` });
    issues.push(`Book: indexed only through a review in “${r.venue}”${ry ? ` (${ry})` : ''}; authors, year and publisher could not be checked`);
    if (idProblems.length) issues.push(...idProblems);
  } else if (best && best.title >= 0.85) {
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
    const bookLike = p.kind === 'book' || /book|monograph|edited/i.test(r.type ?? '');
    let otherItem = false;
    const lowRaw = p.raw.toLowerCase();
    const tAt = lowRaw.indexOf(r.title.toLowerCase().split(/\s+/).slice(0, 3).join(' '));
    const authorRegion = p.raw.slice(0, tAt > 0 ? tAt : Math.ceil(p.raw.length * 0.5));
    const inRaw = au.missing.filter((m) => m.family.length >= 2 && new RegExp(`(?:^|[^\\p{L}])${m.family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^\\p{L}]|$)`, 'iu').test(authorRegion));
    const omittedEff = Math.max(0, au.omitted - inRaw.length);
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
      } else if ((omittedEff >= 2 || (omittedEff >= 1 && omittedEff / r.authors.length >= 0.25)) && citedN < r.authors.length && r.authors.length <= 10 && !r.authorsTruncated && !p.etAl && !bookLike) {
        major++;
        issues.push(`Incomplete author list: ${au.omitted} of ${r.authors.length} authors omitted without “et al.”`);
        checks.push({ field: 'authors', status: 'mismatch', cited: au.cited.map((x) => x.family).join(', '), found: r.authors.slice(0, 8).map((x) => x.family).join(', ') + (r.authors.length > 8 ? ', …' : ''), note: `${au.omitted} author(s) omitted` });
      } else if (um >= 1 || au.givenMismatch > 0 || omittedEff >= 1) {
        minor++;
        const why = recordIncomplete && um ? `the index lists only ${recPeople} author(s); ${au.unmatched.map((x) => x.family).join(', ')} could not be confirmed` : um === 1 ? `“${au.unmatched[0].family}” not found (typo?)` : au.givenMismatch ? 'given-name differences' : bookLike ? `the index also lists ${au.missing.map((x) => x.family).slice(0, 3).join(', ')} (editors, translators or contributors?)` : `${omittedEff} author(s) omitted without “et al.”`;
        checks.push({ field: 'authors', status: 'minor', cited: au.cited.map((x) => x.family).join(', '), found: r.authors.slice(0, 8).map((x) => x.family).join(', '), note: why });
      } else checks.push({ field: 'authors', status: 'match', cited: au.cited.map((x) => x.family).join(', '), found: r.authors.slice(0, 8).map((x) => x.family).join(', ') });
    } else checks.push({ field: 'authors', status: 'na' });
    // year: the closest year among all records of this work (preprint and published versions)
    const sameWork = aligned.filter((x) => x.title >= 0.85 && x.authors.score >= 0.5 && x.yearDiff !== null);
    if (sameWork.length) a.yearDiff = Math.min(a.yearDiff ?? 99, ...sameWork.map((x) => x.yearDiff!));
    // a proceedings paper whose only indexed record is its later journal extension (same title, a few years on)
    // (S2 tags many conference papers "JournalArticle": trust only venue type, Crossref's type or a known journal,
    // and never a record that names a conference)
    const rc = canonVenues(r.venue, ...r.venueAliases);
    const recIsJournal = ![...rc].some((v) => !JOURNAL_CANON.has(v)) && !/conference|proceedings|symposium|workshop/i.test(r.venue ?? '') && (r.venueType === 'journal' || r.type === 'journal-article' || [...rc].some((v) => JOURNAL_CANON.has(v)));
    const citedProc = /proceedings|symposium|workshop|conference/i.test(p.venue ?? '') || [...canonVenues(p.venue)].some((v) => !JOURNAL_CANON.has(v));
    const recFirst = r.years.length ? Math.min(...r.years) : 0;
    const laterVersion = !!p.year && recIsJournal && citedProc && a.title >= 0.95 && au.firstOk && p.year < recFirst && recFirst - p.year <= 4;
    if (a.yearDiff !== null) {
      const onlyPreprints = aligned.filter((x) => x.title >= 0.85).every((x) => !x.rec.venue || PREPRINT_RE.test(x.rec.venue) || x.rec.source === 'datacite');
      const tol = onlyPreprints || PREPRINT_RE.test(p.raw) ? 2 : 1;
      const recMin = Math.min(...r.years);
      const recMax = Math.max(...r.years);
      // a book cited by a later edition or reprint, or an old work whose only record is a modern reprint/digitization
      // (an explicit "2nd ed." / "revised edition" says the cited year is that edition's, whatever the record dates)
      const explicitEdition = /\b(?:\d+(?:st|nd|rd|th)|second|third|fourth|fifth|sixth|revised)\s+(?:rev(?:ised)?\.?\s+)?(?:ed\b|edn\b|edition\b)/i.test(p.raw);
      const edition = !!p.year && ((bookLike && (p.year > recMax || p.year < recMin)) || p.year <= recMin - 10 || explicitEdition);
      if (a.yearDiff > tol && p.kind === 'book' && /chapter|article|section/i.test(r.type ?? '')) otherItem = true;
      if (a.yearDiff > tol && (edition || laterVersion)) {
        minor++;
        checks.push({ field: 'year', status: 'minor', cited: String(p.year), found: r.years.join('/'), note: laterVersion && !edition ? 'the index holds the later journal version of this proceedings paper' : p.year! > recMax ? 'later edition or reprint' : 'the index dates a later reprint or digitized edition' });
      } else if (a.yearDiff > tol) {
        major++;
        issues.push(`Year ${p.year} does not match the published record (${r.years.join('/')})`);
        checks.push({ field: 'year', status: 'mismatch', cited: String(p.year), found: r.years.join('/') });
      } else checks.push({ field: 'year', status: a.yearDiff === 0 ? 'match' : 'minor', cited: String(p.year), found: r.years.join('/') });
    }
    // venue
    const recCanon = canonVenues(r.venue, ...r.venueAliases);
    const laterJournal = laterVersion || a.venueConflict && !!p.year && p.year < Math.min(...r.years) && [...recCanon].every((v) => JOURNAL_CANON.has(v)) && [...canonVenues(p.venue)].some((v) => !JOURNAL_CANON.has(v));
    if (laterJournal) {
      // "Faster R-CNN, NIPS 2015" when the index only holds the 2017 TPAMI extension with the same title and authors
      minor++;
      checks.push({ field: 'venue', status: 'minor', cited: p.venue, found: r.venue, note: 'the index holds the later journal version of this conference paper' });
    } else if (a.venueConflict) {
      major++;
      issues.push(`Venue mismatch: ${a.venueNote}`);
      checks.push({ field: 'venue', status: 'mismatch', cited: p.venue, found: r.venue, note: a.venueNote });
    } else {
      const vj = venueGeneralCheck(p, aligned.filter((x) => x.title >= 0.85 && x.authors.score >= 0.5).map((x) => x.rec).concat([r]));
      if (vj === 'mismatch' && laterVersion) {
        minor++;
        checks.push({ field: 'venue', status: 'minor', cited: p.venue, found: r.venue, note: 'the index holds the later journal version of this proceedings paper' });
      } else if (vj === 'mismatch') {
        major++;
        issues.push(`Published in “${r.venue || r.venueAliases.find(Boolean) || 'another venue'}”, not “${p.venue}”`);
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
    const citedPublished = !!p.venue && !PREPRINT_RE.test(p.venue) && !notYetPublished(p) && (canonVenues(p.venue).size > 0 || /proceedings|journal|transactions|conference|symposium|workshop|meeting|congress|letters|review/i.test(p.venue));
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
    if (otherItem && verdict === 'metadata_error') {
      verdict = 'unverifiable';
      issues.length = 0;
      issues.push(`Book: only a related ${r.type ?? 'record'} (“${r.title}”, ${r.year ?? 'n.d.'}) is indexed, not the book itself; check manually`);
    }
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
    const firstPage = (x?: string) => x?.match(/\d+/)?.[0];
    const nums = new Set(p.raw.replace(/\(\s*(?:1[89]|20)\d\d[a-z]?\s*\)/g, ' ').match(/\b\d{1,5}\b/g) ?? []);
    const titleless = p.title ? undefined : aligned.find((a) => a.authors.firstOk && a.authors.score >= 0.5 && (a.yearDiff ?? 9) <= 1 && !!a.rec.volume && nums.has(a.rec.volume) && !!firstPage(a.rec.pages) && nums.has(firstPage(a.rec.pages)!));
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
    } else if (!p.title && titleless) {
      verdict = 'verified_minor';
      confidence = 0.7;
      best = titleless;
      checks.push({ field: 'title', status: 'na', found: titleless.rec.title, note: 'no title cited; matched by first author, year, volume and page' });
    } else if (!p.title) {
      verdict = 'unverifiable';
      confidence = 0.5;
      issues.push('No title is cited, and no record matched the authors, year, volume and page; check manually');
    } else if (p.placeholders.length) {
      verdict = 'fabricated';
      confidence = 0.02;
      issues.push(`Template / placeholder content: ${p.placeholders.join(', ')}`);
    } else if (partial && seriesDiffer(p.title, partial.rec.title)) {
      // e.g. "The fifth PASCAL RTE challenge" when only the third is indexed: a sibling, not evidence of an error
      verdict = 'unverifiable';
      confidence = 0.5;
      issues.push(`Indexes hold another instalment of this series (“${partial.rec.title}”), not the one cited; check manually`);
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
      const broadDown = ['semanticscholar', 'openalex'].every((s) => !queried.has(s as SourceName) || failed.has(s as SourceName)) && ['semanticscholar', 'openalex'].some((s) => queried.has(s as SourceName));
      // (an arXiv ID alone does not help: arXiv records are looked up through the same broad indexes)
      if (answered.length === 0 || (broadDown && !p.dois.length && !idProblems.length)) {
        // an outage is not evidence against the reference
        verdict = 'unchecked';
        confidence = 0.5;
        issues.push(answered.length === 0 ? 'No scholarly index responded; retry later' : 'Semantic Scholar and OpenAlex did not respond, and the other indexes do not cover this kind of work; retry later');
      } else if (p.year && p.year < 1950 && !p.dois.length) {
        // index coverage before 1950 is sparse (archival sources, old periodicals): absence is not evidence
        verdict = 'unverifiable';
        confidence = 0.5;
        issues.push(`Published ${p.year}: scholarly indexes cover this period sparsely; check manually`);
      } else if (!p.dois.length && (LANG_TAG_RE.test(p.raw) || TRANSLATED_TITLE_RE.test(p.raw))) {
        // the reference itself marks the work as non-English (a language tag, or a [bracketed translation] of
        // the title): regional literature is sparsely indexed, so absence is not evidence
        verdict = 'unverifiable';
        confidence = 0.5;
        const lang = p.raw.match(LANG_TAG_RE)?.[1];
        issues.push(`${lang ? `Cited as a ${lang.toLowerCase()}-language work` : 'Cited with a translated title'}: scholarly indexes cover non-English literature sparsely; check manually`);
      } else {
        // only call it fabricated when the broad-coverage indexes actually answered
        const majorDown = ['semanticscholar', 'openalex'].filter((s) => queried.has(s as SourceName) && failed.has(s as SourceName));
        // "fabricated" is the harshest label: require both broad-coverage indexes to have answered
        const strong = answered.length >= 2 && majorDown.length === 0;
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

  // forthcoming / same-volume works are not indexed yet; a similar older record is not evidence against them
  if (/\bin these proceedings\b|\bthis volume\b|\bforthcoming\b|\bin press\b|\bto appear\b|\bin preparation\b|\b(?:work )?in progress\b|\bunpublished\b|\b(?:private|personal) communication\b/i.test(p.raw) && (verdict === 'fabricated' || verdict === 'not_found' || (verdict === 'metadata_error' && checks.some((c) => c.status === 'mismatch' && (c.field === 'year' || c.field === 'authors'))))) {
    verdict = 'unverifiable';
    confidence = 0.5;
    issues.length = 0;
    issues.push('Forthcoming, unpublished or same-volume work: not indexed; check manually');
    best = undefined;
  }

  // placeholder text is decisive even if a related work exists
  if (p.placeholders.length && verdict !== 'fabricated') {
    issues.push(`Template / placeholder content: ${p.placeholders.join(', ')}`);
    if (verdict === 'verified' || verdict === 'verified_minor') verdict = 'metadata_error';
  }
  // weak LLM tell: "Name and et al."
  if (/\band et al\b/i.test(p.raw)) issues.push('“and et al.” pattern (common in machine-generated references)');

  /* 4. retraction */
  const m = best && best.title >= 0.85 && !review ? best.rec : verdict === 'verified' && software ? software : undefined;
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
    // (a reference without a title is matched by first author, year, volume and page: show that record too)
    match: best && (best.title >= 0.6 || verdict === 'verified' || (!p.title && verdict === 'verified_minor')) ? best.rec : undefined,
    checks,
    issues,
    candidates: all.slice(0, 5),
    sourcesQueried: [...queried],
    sourcesFailed: [...failed],
    suggestedFix: best && best.title >= 0.85 && verdict !== 'verified' && !review ? formatReference(best.rec) : undefined,
  };
}

/** A same-titled record with no author in common and a distant year is a different work (generic titles). */
function differentWork(a: Alignment): boolean {
  return a.authors.cited.length > 0 && a.authors.matched === 0 && (a.yearDiff ?? 0) > 2 && tokens(a.rec.title).length <= 5;
}

function pickBest(aligned: Alignment[], p?: ParsedRef): Alignment | undefined {
  // among strong title matches prefer the best author agreement; prefer published over preprint on ties
  // The question is whether a record exists that matches the reference *as cited*, so among
  // same-title records (re-deposits, preprint vs. published versions) prefer the one that agrees
  // with the most cited fields.
  const strong = aligned.filter((a) => a.title >= 0.85 && !differentWork(a));
  if (!strong.length) return aligned.find((a) => a.title < 0.85) ?? undefined;
  const agree = (a: Alignment) => {
    const y = a.yearDiff === null ? 0.5 : a.yearDiff === 0 ? 1 : a.yearDiff === 1 ? 0.75 : a.yearDiff === 2 ? 0.3 : 0;
    const rich = (a.rec.venueAliases.length > 1 ? 0.05 : 0) + (a.rec.doi || a.rec.arxivId ? 0.05 : 0);
    return a.title * 0.5 + a.authors.score + y * 0.8 - (a.venueConflict ? 0.4 : 0) - a.authors.unmatched.length * 0.1 + rich - (p && isBookReview(p, a.rec) ? 0.8 : 0);
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
const LANG_TAG_RE = /[([]\s*in\s+(Russian|Ukrainian|Chinese|Japanese|Korean|German|French|Spanish|Portuguese|Italian|Polish|Czech|Turkish|Persian|Arabic|Hebrew|Hindi|Indonesian|Vietnamese|Thai|Greek|Dutch|Swedish|Norwegian|Danish|Finnish|Hungarian|Romanian|Bulgarian|Serbian|Croatian|Slovak|Slovenian|Lithuanian|Latvian|Estonian|Belarusian|Kazakh|Georgian|Armenian|Catalan|Latin)\b[^)\]]{0,40}[)\]]/i;
// "Original title [English translation of four or more words]" (not "[Online]", "[Accessed 1 May 2020]")
const TRANSLATED_TITLE_RE = /\s\[(?!(?:Accessed|Online|Internet|Cited|Retrieved|Viewed|Computer|Electronic|In press|Preprint)\b)\p{Lu}[\p{L}’'-]*(?:\s+[\p{L}’'-]+){3,}\]/u;
const ORDINAL_RE = /^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d+(?:st|nd|rd|th)?)$/;
function seriesDiffer(cited: string, found: string): boolean {
  const A = fold(cited).split(' ');
  const B = fold(found).split(' ');
  if (A.length !== B.length || A.length < 3) return false;
  const diff = A.map((t, i) => [t, B[i]] as const).filter(([x, y]) => x !== y);
  return diff.length === 1 && ORDINAL_RE.test(diff[0][0]) && ORDINAL_RE.test(diff[0][1]);
}

export function titleDiff(cited: string, found: string): { kind: 'identical' | 'cosmetic' | 'subtitle' | 'omission' | 'word'; words: string[] } {
  // an edition suffix on either side ("A Multigrid Tutorial, Second Edition") is not a different title
  const ED = / (?:first|second|third|fourth|fifth|sixth|\d+(?:st|nd|rd|th)?) (?:edition|ed)$/;
  const a = fold(cited).replace(ED, '');
  const b = fold(found).replace(ED, '');
  if (a === b) return { kind: 'identical', words: [] };
  if (a.replace(/ /g, '') === b.replace(/ /g, '')) return { kind: 'cosmetic', words: [] };
  // one title is the other plus a subtitle (after a colon or dash)
  if (a.length >= 12 && b.startsWith(a + ' ') && /[:\-–—]/.test(found)) return { kind: 'subtitle', words: [] };
  if (b.length >= 12 && a.startsWith(b + ' ') && /[:\-–—]/.test(cited)) return { kind: 'subtitle', words: [] };
  // "and" and a leading article ("The KGB…" vs "KGB…") are not substantive differences
  const A = a.replace(/^(?:the|a|an) /, '').split(' ').filter((t) => t !== 'and').map(normWord);
  const B = b.replace(/^(?:the|a|an) /, '').split(' ').filter((t) => t !== 'and').map(normWord);
  const cnt = new Map<string, number>();
  for (const t of A) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  for (const t of B) cnt.set(t, (cnt.get(t) ?? 0) - 1);
  // a year that only the cited "title" has was glued on by the parse ("Agent workflow memory, 2024")
  let plus = [...cnt.entries()].filter(([, v]) => v > 0).map(([t]) => t).filter((t) => !/^(?:19|20)\d\d$/.test(t));
  let minus = [...cnt.entries()].filter(([, v]) => v < 0).map(([t]) => t);
  if (!plus.length && !minus.length) return { kind: 'cosmetic', words: [] };
  // the published title appears intact inside the cited one: the parse ran into the year or venue
  if (B.length >= 4 && ` ${A.join(' ')} `.includes(` ${B.join(' ')} `)) return { kind: 'subtitle', words: [] };
  // the cited title stops at a "?" or "!" that the published title continues past
  if (!plus.length && /[?!]/.test(found) && B.slice(0, A.length).join(' ') === A.join(' ')) return { kind: 'subtitle', words: [] };
  // symbols lost in PDF text extraction: subscripts ("CO 2" vs "CO"), Greek letters ("τ-bench" → "au-bench"),
  // accents split off ("K\"ahler"), hats ("R̂" → "Rb"), LaTeX commands ("\operatorname{SLE}")
  const symbolic = /[^\x00-\x7F]|\\[a-z]+/i.test(found) || /[^\x00-\x7F]/.test(cited);
  minus = minus.filter((m) => !(/^\d{1,2}$/.test(m) || m.length === 1));
  const pairs = (t: string, m: string) => {
    const [s, l] = t.length <= m.length ? [t, m] : [m, t];
    if ((s.length >= 3 || /\d/.test(l)) && (l.startsWith(s) || l.endsWith(s))) return true;
    return t.length >= 5 && [...t].sort().join('') === [...m].sort().join(''); // transposed letters ("Weiner")
  };
  // a compound joined by hyphenation removal ("softwareengineering" for "software engineering")
  for (const [X, Y] of [[plus, minus], [minus, plus]] as const) {
    for (const t of [...X]) {
      const hit = Y.flatMap((m1) => Y.filter((m2) => m2 !== m1 && m1 + m2 === t).map((m2) => [m1, m2]))[0];
      if (hit) {
        X.splice(X.indexOf(t), 1);
        for (const m of hit) Y.splice(Y.indexOf(m), 1);
      }
    }
  }
  const freeM = [...minus];
  plus = plus.filter((t) => {
    const k = freeM.findIndex((m) => pairs(t, m));
    if (k < 0) return !(symbolic && t.length <= 3);
    freeM.splice(k, 1);
    return false;
  });
  minus = freeM;
  if (!plus.length && !minus.length) return { kind: 'cosmetic', words: [] };
  // joined/split compounds: "pre training" vs "pretraining"
  if ([...plus].sort().join('') === [...minus].sort().join('') || plus.join('') === minus.join('')) return { kind: 'cosmetic', words: [] };
  // plural/singular only
  if (plus.length === minus.length && plus.every((t) => minus.some((m) => m === t + 's' || t === m + 's' || m === t + 'es' || t === m + 'es'))) return { kind: 'cosmetic', words: [] };
  // math in the title (particle physics: "B0 → D K0S π+"): the text layer scatters sub- and superscripts and the index
  // writes them in LaTeX, so leftovers are short symbol tokens ("ks0" vs "k0 s", "d0bar", "pi"). Only when the title
  // really carries math, at least one leftover mixes letters and digits, and no ordinary word differs.
  const mathy = symbolic || /[$_^]|\\[a-z]+|→/.test(found + cited);
  const sym = (t: string) => /^[a-z]{0,5}\d[a-z\d]{0,5}$/.test(t) || /^[a-z]{1,3}$/.test(t) || /^[a-z]\d?bar$/.test(t);
  const left = [...plus, ...minus];
  if (mathy && left.length && left.every(sym) && left.some((t) => /[a-z]/.test(t) && /\d/.test(t))) return { kind: 'cosmetic', words: [] };
  if (!plus.length && minus.length === 1) return { kind: 'omission', words: [`missing “${minus[0]}”`] };
  if (!plus.length && A.length >= 3 && B.slice(0, A.length).join(' ') === A.join(' ')) return { kind: 'omission', words: ['abbreviated title'] };
  return { kind: 'word', words: [...plus.map((t) => `cited “${t}”`), ...minus.map((t) => `published “${t}”`)].slice(0, 6) };
}

/* ------------------------------ venue (general) ------------------------------ */

const VENUE_STOP = new Set('proceedings proc of the in on and for international intl conference conf annual meeting workshop workshops symposium journal j ieee acm transactions trans advances adv th st nd rd volume vol part series lecture notes computer science lncs findings association new york ny usa pp p pages page no doi url issn isbn publisher en inc press ed eds editors at'.split(' '));

const NLM_PLACE = new Set('lond engl basel oxf phila berl wash chic auckl edinb amst balt noisy grand'.split(' '));

function venueTokens(s: string): string[] {
  return fold(s)
    .split(' ')
    // volume, page and article numbers ("4", "eaat0346", "l167") never name a venue
    .filter((t) => t && !VENUE_STOP.has(t) && !/\d/.test(t));
}

/** Initials of every word but articles and prepositions: "Journal of High Energy Physics" → "jhep". */
function fullInitials(s: string): string {
  return fold(s)
    .split(' ')
    .filter((t) => t && !/^(?:of|the|and|for|on|in|at|a|an)$/.test(t) && !/\d/.test(t))
    .map((t) => t[0])
    .join('');
}

function initials(s: string): string {
  // initials of the informative words only ("Proceedings on I Can't Believe It's Not Better…" → "icbinb…")
  return venueTokens(s)
    .map((t) => t[0])
    .join('');
}

/** Does the cited venue plausibly name the venue of any of the records (aliases, abbreviations, acronyms)? */
export function venueGeneralCheck(p: ParsedRef, recs: WorkRecord[]): 'match' | 'mismatch' | 'unknown' {
  if (!p.venue || PREPRINT_RE.test(p.venue) || notYetPublished(p)) return 'unknown';
  // "Technical report", "PhD thesis": a document type, not a venue
  if (p.kind === 'report' || p.kind === 'thesis' || /^(?:tech(?:nical|\.)?\s*rep(?:ort|\.)?|(?:ph\.?\s?d\.?|master'?s|doctoral)\s*(?:thesis|dissertation)|thesis|dissertation|manuscript|unpublished|white\s*paper)\b/i.test(p.venue.trim())) return 'unknown';
  // a publisher ("Cambridge University Press", "Springer") is not a venue that can be compared
  if (p.kind === 'book' || /\b(?:press|publish(?:ers?|ing)|springer|elsevier|wiley|routledge|crc|academic|verlag|sage|mit|university of [a-z]+)\b/i.test(p.venue) && !/journal|proceedings|transactions|conference/i.test(p.venue)) return 'unknown';
  const names = recs.flatMap((r) => [r.venue, ...r.venueAliases].filter((x) => !!x && fold(x) !== fold(r.title))).filter((x): x is string => !!x && !PREPRINT_RE.test(x) && !/^(?:front matter|unknown)$/i.test(x));
  if (!names.length) return 'unknown';
  const rawF = ' ' + fold(p.raw) + ' ';
  if (names.some((n) => venueTokens(n).length >= 2 && rawF.includes(' ' + fold(n) + ' '))) return 'match';
  // A parsed "venue" can be the end of the title. Recover it only when the actual reference explicitly
  // names the record's venue outside that complete title (and outside URLs).
  const parsedVenueWords = venueTokens(p.venue);
  for (const r of recs) {
    const title = fold(r.title);
    if (!title || !rawF.includes(' ' + title + ' ') || !parsedVenueWords.length || !parsedVenueWords.every((w) => title.split(' ').includes(w))) continue;
    const remainder = fold(p.raw.replace(/https?:\/\/\S+/g, ' ')).replace(title, ' ');
    const cited = canonVenues(remainder);
    if ([...canonVenues(r.venue, ...r.venueAliases)].some((v) => cited.has(v))) return 'match';
  }
  // the parser cut the title at "?" or "." and read the subtitle as the start of the venue:
  // "Survival of the fittest? | Entrepreneurial human capital … firms. Adm Sci Q" → venue "Adm Sci Q"
  let venue = p.venue;
  const pt = fold(p.title ?? '');
  for (const r of recs) {
    const rt = fold(r.title ?? '');
    if (!pt || !rt.startsWith(pt + ' ')) continue;
    const rest = rt.slice(pt.length).trim().split(' ');
    const vw = venue.split(/\s+/);
    if (vw.length > rest.length && fold(vw.slice(0, rest.length).join(' ')) === rest.join(' ')) {
      venue = vw.slice(rest.length).join(' ');
      break;
    }
  }
  if (venue !== p.venue) return venueGeneralCheck({ ...p, venue, title: undefined }, recs);
  // a title with commas in its math ("… B0 → D±π∓, D±π∓, … decays, Nucl. Phys. B671") runs into the venue: the
  // journal is the last comma segment, often with the volume glued to the series letter
  if (p.venue.includes(',')) {
    const last = p.venue.slice(p.venue.lastIndexOf(',') + 1).replace(/\b([A-Z])(\d+)\b/g, '$1 $2').trim();
    if (venueTokens(last).length >= 2 && venueGeneralCheck({ ...p, venue: last, title: undefined }, recs) === 'match') return 'match';
  }
  const C = venueTokens(p.venue);
  // NLM abbreviations tell same-named journals apart by place of publication ("Infect Dis (Lond)", "… Lond Engl",
  // "Cell Mol Biol (Noisy-le-grand)"): a trailing place is not part of the journal's name
  while (C.length > 2 && NLM_PLACE.has(C[C.length - 1])) C.pop();
  if (C.length > 3 && C[C.length - 2] === 'n' && C[C.length - 1] === 'y') C.splice(-2);
  if (!C.length) return 'unknown';
  const citedCanon = canonVenues(p.venue);
  const recCanon = canonVenues(...names);
  if (citedCanon.size && recCanon.size) return [...citedCanon].some((v) => recCanon.has(v)) ? 'match' : 'mismatch';
  const cInit = initials(p.venue);
  const cf = fold(p.venue);
  const caps = (p.venue.match(/\b[A-Z][A-Za-z]*[a-z][A-Za-z]*[A-Z][A-Za-z]*\b/g) ?? []).map((w) => w.replace(/[^A-Z]/g, '').toLowerCase()).filter((k) => k.length >= 3);
  for (const n of names) {
    const N = venueTokens(n);
    if (!N.length) continue;
    const nf = fold(n);
    // abbreviation-aware coverage ("IEEE Trans. Pattern Anal. Mach. Intell.")
    // (abbreviations may stand for stop words of the long form: "Assoc" → "Association", "Am" → "American")
    const NF = nf.split(' ').filter(Boolean);
    const covered = C.filter((c) => NF.some((t) => t === c || (c.length >= 3 && t.startsWith(c)) || (c.length === 2 && t.length >= 6 && t.startsWith(c)) || (t.length >= 3 && c.startsWith(t) && N.includes(t)) || ratio(t, c) >= 0.85)).length;
    if (covered / C.length >= 0.6) return 'match';
    // acronym ↔ long form ("TPAMI", "JMLR", "CVPR"); "JOSA A" / "JHEP" keep the initial of "Journal"
    const nFull = fullInitials(n);
    if (C.some((c) => c.length >= 4 && (c === nFull || nFull.startsWith(c)))) return 'match';
    const nInit = initials(n);
    if (C.some((c) => c.length >= 3 && (c === nInit || nf.split(' ').includes(c)))) return 'match';
    if (N.some((t) => t.length >= 3 && (t === cInit || (t.length >= 4 && cInit.startsWith(t)) || cf.split(' ').includes(t)))) return 'match';
    if (C.some((c) => c.length >= 4 && nInit.startsWith(c))) return 'match';
    // capitals of a mixed-case acronym are the initials of the long form: "CoNLL" → CNLL, "NeurIPS" → NIPS
    const fullInit = nf.split(' ').filter((t) => t && !/^(?:of|the|on|at|and|in|for|\d+)$/.test(t)).map((t) => t[0]).join('');
    if (caps.some((k) => nInit === k || (k.length >= 4 && (nInit.includes(k) || fullInit.includes(k))))) return 'match';
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
