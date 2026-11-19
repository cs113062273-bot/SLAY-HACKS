import type { Verdict } from '../core/types';
import type { SupportLabel } from '../engine/session';

export const VERDICT: Record<Verdict | 'pending', { label: string; short: string; help: string; color: string }> = {
  verified: { label: 'Verified', short: 'Verified', help: 'The work exists and the cited title, authors, year and venue match the published record.', color: 'var(--ok)' },
  verified_minor: { label: 'Minor issues', short: 'Minor', help: 'The work exists. Small discrepancies such as a misspelled name or a one-year offset.', color: 'var(--minor)' },
  metadata_error: { label: 'Wrong details', short: 'Details', help: 'A real work matches the title, but authors, venue, year or other core details are wrong.', color: 'var(--warn)' },
  id_mismatch: { label: 'Wrong identifier', short: 'Wrong ID', help: 'The DOI or arXiv ID resolves to a different work than the one cited.', color: 'var(--bad)' },
  fabricated: { label: 'Likely fabricated', short: 'Fabricated', help: 'No matching work in any scholarly index, or the entry contains template text.', color: 'var(--bad)' },
  not_found: { label: 'Not found', short: 'Not found', help: 'Could not be matched to any indexed record. Check it by hand.', color: 'var(--bad)' },
  unverifiable: { label: 'Not indexed', short: 'Not indexed', help: 'A website, standard, report or other source that scholarly indexes do not cover.', color: 'var(--rule-2)' },
  retracted: { label: 'Retracted', short: 'Retracted', help: 'The cited work has a retraction notice.', color: 'var(--violet)' },
  pending: { label: 'Checking', short: 'Checking', help: '', color: 'var(--wash)' },
};

export const VERDICT_ORDER: (Verdict | 'pending')[] = ['fabricated', 'id_mismatch', 'not_found', 'retracted', 'metadata_error', 'verified_minor', 'verified', 'unverifiable', 'pending'];

export const SUPPORT: Record<SupportLabel | 'none', { label: string; help: string }> = {
  supported: { label: 'Supported', help: 'The cited passages state what the sentence attributes to this work.' },
  review: { label: 'Needs review', help: 'The cited passages do not clearly back this sentence. Read them before relying on the citation.' },
  unclear: { label: 'Inconclusive', help: 'The evidence is mixed, so no verdict is shown. The passages below are the closest matches.' },
  mention: { label: 'Mention', help: 'The sentence names or gives the work as an example; it does not attribute a finding to it.' },
  none: { label: 'No source text', help: 'No abstract or open-access full text was available.' },
};

export function isProblem(v: Verdict) {
  return v === 'fabricated' || v === 'id_mismatch' || v === 'not_found' || v === 'metadata_error' || v === 'retracted';
}

/** Reference numbers from the document ("12") when short; otherwise the list position. */
export function shortLabel(label: string | undefined, i: number): string {
  return label && label.length <= 4 ? label : String(i + 1);
}
