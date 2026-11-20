/** Bounded pre-audit fixes: compare exact-span optimization with the frozen fuzzy routine and preserve venue mismatches. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fuzzyFind, ratio, tokens } from '../src/core/text';
import { parseReference } from '../src/core/parse';
import { venueGeneralCheck } from '../src/core/verify';
import type { WorkRecord } from '../src/core/types';

// Reference algorithm from 497cb22, before the exact-span fast path.
function frozenFuzzy(needle: string, haystack: string) {
  const n = tokens(needle), h = tokens(haystack);
  if (!n.length || !h.length) return { score: 0, start: -1, end: -1 };
  const nj = n.join(' ');
  let best = { score: 0, start: -1, end: -1 };
  for (let i = 0; i < h.length; i++) {
    for (let w = Math.max(1, n.length - 3); w <= n.length + 3 && i + w <= h.length; w++) {
      const seg = h.slice(i, i + w).join(' ');
      if (Math.abs(seg.length - nj.length) > nj.length * .5) continue;
      const s = ratio(seg, nj);
      if (s > best.score) best = { score: s, start: i, end: i + w };
    }
  }
  return best;
}
const frozen = JSON.parse(readFileSync('../data/blind/results.json', 'utf8'));
const examples = frozen.papers.flatMap((p: any) => p.flags).filter((f: any) => f.match?.title).slice(0, 20);
for (const f of examples) assert.deepEqual(fuzzyFind(f.match.title, f.raw), frozenFuzzy(f.match.title, f.raw));
for (const [n, h] of [['', 'text'], ['term', 'a term and term'], ['two words', 'two-words two words'], ['new title', 'a different phrase']]) assert.deepEqual(fuzzyFind(n, h), frozenFuzzy(n, h));

const aas = parseReference('Harris, C. R., Millman, K. J., van der Walt, S. J., et al. 2020, Array programming with NumPy, Nature, 585, 357, doi:10.1038/s41586-020-2649-2');
assert.equal(aas.year, 2020);
assert.equal(aas.authors[0].family, 'Harris');
assert.equal(aas.title, 'Array programming with NumPy');
assert.equal(aas.venue, 'Nature');
const planck = parseReference('Planck Collaboration, Aghanim, N., Akrami, Y., et al. 2020, Planck 2018 results. VI. Cosmological parameters, Astronomy and Astrophysics, 641, A6.');
assert.equal(planck.year, 2020);
assert.equal(planck.venue, 'Astronomy and Astrophysics');
const dated = parseReference('A. Miller. 2022. A useful scientific study. (December 2022).');
assert.equal(dated.venue, undefined);
const realVenue = parseReference('A. Miller. 2022. A useful scientific study. Nature, December 2022.');
assert.ok(realVenue.venue?.includes('Nature'));

const title = 'Automatic Prompt Optimization with Gradient Descent and Beam Search';
const rec = { title, venue: 'Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing', venueAliases: [] } as unknown as WorkRecord;
const ref = { ...parseReference(`A. Miller. ${title}. In EMNLP, 2023.`), title: 'Automatic Prompt Optimization with Gradient Descent', venue: 'and Beam Search' };
assert.equal(venueGeneralCheck(ref, [rec]), 'match');
assert.equal(venueGeneralCheck({ ...ref, raw: `A. Miller. ${title}. In ICML, 2023.`, venue: 'ICML' }, [rec]), 'mismatch');
assert.equal(venueGeneralCheck({ ...ref, raw: `A. Miller. ${title}. Imaginary Symposium, 2023. https://emnlp.org/` }, [rec]), 'mismatch');
console.log(JSON.stringify({ passed: true, fuzzyEquivalenceCases: examples.length + 4, structuralYearDateAssertions: 8, venueAssertions: 3, networkRequests: 0 }));
