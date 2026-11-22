export interface Person {
  family: string;
  given?: string;
}

/** A reference string after heuristic parsing. Every field is optional except raw. */
export interface ParsedRef {
  raw: string;
  /** the string with identifiers/urls removed, used for searching */
  clean: string;
  label?: string; // "12", "Smith2020", …
  dois: string[];
  arxivIds: string[];
  urls: string[];
  pmid?: string;
  year?: number;
  years: number[];
  authors: Person[];
  authorsText?: string;
  etAl: boolean;
  title?: string;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  kind: RefKind;
  placeholders: string[];
}

export type RefKind =
  | 'article' // journal / conference / preprint
  | 'book'
  | 'thesis'
  | 'report'
  | 'software' // github, pypi, huggingface, zenodo software
  | 'dataset'
  | 'web' // web page, standard, blog, model card
  | 'unknown';

/** A normalized scholarly record from any source. */
export interface WorkRecord {
  source: SourceName;
  sourceId: string;
  url?: string;
  title: string;
  authors: Person[];
  authorsTruncated?: boolean;
  year?: number;
  years: number[];
  venue?: string;
  venueAliases: string[];
  venueType?: string; // conference | journal | repository | book …
  type?: string;
  doi?: string;
  arxivId?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  abstract?: string;
  pdfUrl?: string;
  isRetracted?: boolean;
  updates?: { type: string; doi?: string; label?: string }[];
  /** notices that update this work (retraction, correction…), when the source embeds them (Crossref `updated-by`) */
  updatedBy?: { type: string; doi?: string }[];
}

export type SourceName =
  | 'crossref'
  | 'openalex'
  | 'semanticscholar'
  | 'datacite'
  | 'europepmc'
  | 'inspire'
  | 'github'
  | 'huggingface'
  | 'pubmed';

export type FieldStatus = 'match' | 'minor' | 'mismatch' | 'missing' | 'na';

export interface FieldCheck {
  field: 'title' | 'authors' | 'year' | 'venue' | 'identifier' | 'pages';
  status: FieldStatus;
  cited?: string;
  found?: string;
  note?: string;
  score?: number;
}

export type Verdict =
  | 'verified' // exists and core metadata matches
  | 'verified_minor' // exists; small cosmetic discrepancies (typos in names, year ±1)
  | 'metadata_error' // exists but core metadata is wrong (authors/venue/year)
  | 'id_mismatch' // identifier resolves to a different work
  | 'fabricated' // no matching work found anywhere; strong fabrication signals
  | 'not_found' // scholarly-looking but not found in any index
  | 'unverifiable' // non-scholarly (web/standard/report) that cannot be checked in indexes
  | 'unchecked' // the indexes needed to judge it did not respond (outage, rate limit): never flagged
  | 'retracted';

export interface RefResult {
  index: number;
  parsed: ParsedRef;
  verdict: Verdict;
  /** 0–1 confidence that the reference is genuine and accurately cited */
  confidence: number;
  match?: WorkRecord;
  checks: FieldCheck[];
  issues: string[];
  candidates: WorkRecord[];
  sourcesQueried: SourceName[];
  sourcesFailed: SourceName[];
  suggestedFix?: string; // corrected reference / BibTeX
}

export const FLAGGED_VERDICTS: Verdict[] = ['metadata_error', 'id_mismatch', 'fabricated', 'not_found', 'retracted'];
