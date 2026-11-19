import { readFileSync } from 'node:fs';
export interface BenchRow { doc: string; num: string; reference: string; label: 'verified' | 'problematic'; tools: Record<string, boolean> }
/** Loads the Badalova & Mayr benchmark. The CSV lost curly quotes/dashes (became '?'); we restore them. */
export function loadBench(): BenchRow[] {
  const rows = JSON.parse(readFileSync(new URL('../../data/zenodo/refs.json', import.meta.url), 'utf8'));
  return rows.map((r: any) => ({
    doc: r.document_id,
    num: r.reference_number,
    reference: repair(r.reference),
    label: r.manual_label,
    tools: Object.fromEntries(['checkifexist', 'hallucitechecker', 'hallucinator', 'halref', 'refchecker'].map((k) => [k, r[k] === 'flagged'])),
  }));
}
function repair(s: string): string {
  return s
    .replace(/(\d)\?(\d)/g, '$1–$2') // lost en dash in page ranges
    .replace(/(\p{L})\?(t|s|ll|re|ve|d|m)\b/gu, '$1’$2') // lost apostrophes ("don?t", "Stanford?s")
    .replace(/(^|[\s.(])\?([^?]{6,}?)\?(?=[.,\s]|$)/g, '$1“$2”') // lost curly quotes
    .replace(/ \? (?=\p{Lu})/gu, ' … '); // lost ellipsis in long author lists
}
