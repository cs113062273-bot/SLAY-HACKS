/**
 * Development re-check of a SPENT blind set (its frozen result is already reported): re-run the current core on its
 * PDFs and compare with the hand-judged flags of the frozen run. Shows which judged false alarms are gone, whether
 * every judged real error is still flagged, and every new flag (to be judged by hand). Never use on an unspent set.
 * Uses the shared HTTP cache (data/cache/http.json), so repeated runs are mostly offline.
 * Usage: BLIND_SET=2 npx tsx scripts/recheck-blind.ts   (BLIND_SET=1 for data/blind/)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDoc } from '../src/core/doc';
import { Http } from '../src/core/http';
import { pdfToLines } from '../src/core/pdf';
import { FLAGGED_VERDICTS, type RefResult } from '../src/core/types';
import { verifyReference } from '../src/core/verify';
import { makeCache, replayMisses, replayRef } from './node-cache';

const B = process.env.BLIND_SET && process.env.BLIND_SET !== '1' ? `blind${process.env.BLIND_SET}` : 'blind';
const suffix = process.env.RECHECK_SUFFIX ?? '';
if (!/^(?:-[a-z0-9-]+)?$/i.test(suffix)) throw new Error('Invalid recheck output suffix');
const root = fileURLToPath(new URL('../../data/', import.meta.url));
const frozen = JSON.parse(readFileSync(`${root}${B}/results.json`, 'utf-8'));
if (!frozen.review) throw new Error(`${B} has not been judged yet: re-checking is only for spent, judged sets`);
const correctionsPath = `${root}${B}/review-corrections.json`;
const corrections = new Map<number, string>(existsSync(correctionsPath)
  ? JSON.parse(readFileSync(correctionsPath, 'utf8')).corrections.map((c: any) => [c.reviewIndex, c.correctedJudgement]) : []);
const cache = makeCache(`${root}cache/http.json`);
const replay = !!process.env.VERACITE_REPLAY;
const http = new Http({ cache, maxRetries: replay ? 0 : 6 });
let refSeq = 0;

const toks = (s: string) => new Set(s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 2));
const sim = (a: string, b: string) => {
  const A = toks(a);
  const Bt = toks(b);
  let n = 0;
  for (const t of A) if (Bt.has(t)) n++;
  return n / Math.max(1, Math.min(A.size, Bt.size));
};

const out: string[] = [];
const tally = { oldFalse: 0, oldFalseGone: 0, oldFalseGoneUnanswered: 0, newFlagsUnanswered: 0, oldReal: 0, oldRealKept: 0, oldUncertain: 0, oldUncertainKept: 0, refs: 0, flagsNow: 0, newFlags: 0 };
for (const p of frozen.papers) {
  const { lines, pageWidths } = await pdfToLines(pdfjs as any, new Uint8Array(readFileSync(`${root}pdfs/${B}/${p.file}`)));
  const doc = buildDoc(lines, pageWidths);
  const res: RefResult[] = new Array(doc.references.length);
  const ids: number[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < doc.references.length) {
        const i = next++;
        ids[i] = refSeq++;
        res[i] = await replayRef.run(ids[i], () => verifyReference(doc.references[i], { http, budgetMs: 60000 }, i));
      }
    }),
  );
  cache.flush();
  // a lookup that no recorded response answered (replay) or that failed live can hide a flag: such a disappearance is not a fix
  const unanswered = (i: number) => replayMisses.has(ids[i]) || res[i].verdict === 'unchecked';
  const tag = (i: number) => (replay && replayMisses.has(ids[i]) ? ` [${replayMisses.get(ids[i])!.length} unrecorded lookups]` : '');
  tally.refs += res.length;
  const flaggedNow = new Set(res.map((r, i) => (FLAGGED_VERDICTS.includes(r.verdict) ? i : -1)).filter((i) => i >= 0));
  tally.flagsNow += flaggedNow.size;
  const explained = new Set<number>();
  out.push(`\n=== ${p.file}: refs ${p.refs} → ${res.length}, flags ${p.flagged} → ${flaggedNow.size}`);
  for (const f of p.flags) {
    // the same reference in the new parse: best raw-text overlap
    let bi = -1;
    let bs = 0;
    doc.rawReferences.forEach((raw, i) => {
      const s = sim(f.raw, raw);
      if (s > bs) {
        bs = s;
        bi = i;
      }
    });
    const judgement = corrections.get(f.reviewIndex) ?? f.judgement;
    const kind = judgement.startsWith('false') ? 'false' : judgement.startsWith('uncertain') ? 'uncertain' : 'real';
    const now = bi >= 0 && bs >= 0.5 ? res[bi] : undefined;
    const still = !!now && flaggedNow.has(bi);
    if (bi >= 0 && bs >= 0.5) explained.add(bi);
    if (kind === 'false') {
      tally.oldFalse++;
      if (!still) tally.oldFalseGone++;
      if (!still && now && unanswered(bi)) tally.oldFalseGoneUnanswered++;
    } else if (kind === 'real') {
      tally.oldReal++;
      if (still) tally.oldRealKept++;
    } else {
      tally.oldUncertain++;
      if (still) tally.oldUncertainKept++;
    }
    const mark = kind === 'false' ? (still ? 'STILL FALSE' : 'fixed') : kind === 'real' ? (still ? 'real kept' : 'REAL LOST') : still ? 'uncertain kept' : 'uncertain gone';
    out.push(`  #${f.reviewIndex} ${mark.padEnd(14)} ${f.verdict} → ${now?.verdict ?? 'missing'}${now ? tag(bi) : ''}  ${f.raw.slice(0, 90)}`);
    if (still || kind === 'real') out.push(`      now: ${now?.issues.join(' | ').slice(0, 220)}`);
  }
  for (const i of flaggedNow) {
    if (explained.has(i)) continue;
    tally.newFlags++;
    if (unanswered(i) || res[i].sourcesFailed.length) tally.newFlagsUnanswered++;
    const r = res[i];
    out.push(`  NEW FLAG [${i + 1}] ${r.verdict}${tag(i)}  ${doc.rawReferences[i].slice(0, 200)}\n      ${r.issues.join(' | ').slice(0, 260)}\n      rec: ${r.match ? `${r.match.title} / ${r.match.authors.slice(0, 4).map((a) => a.family).join(', ')} / ${r.match.years.join('/')} / ${r.match.venue ?? ''} / ${r.match.doi ?? ''}` : '-'}`);
  }
  console.log(`${B}: completed ${p.file}, ${res.length} refs, ${flaggedNow.size} flags`);
  writeFileSync(`${root}${B}/recheck${suffix}-progress.json`, JSON.stringify({ completedThrough: p.file, tally }, null, 2));
}
const summary = `\n${B} re-check with the current core: refs ${tally.refs}, flags now ${tally.flagsNow}; judged false alarms fixed ${tally.oldFalseGone}/${tally.oldFalse}; judged real errors still flagged ${tally.oldRealKept}/${tally.oldReal}; uncertain still flagged ${tally.oldUncertainKept}/${tally.oldUncertain}; new flags to judge ${tally.newFlags}; of the fixes, ${tally.oldFalseGoneUnanswered} only became unchecked/unanswered; ${tally.newFlagsUnanswered} new flags had a failed or unrecorded lookup${replay ? ' (offline replay of recorded responses)' : ''}`;
console.log(out.join('\n') + summary);
writeFileSync(`${root}${B}/recheck${suffix}.txt`, out.join('\n') + summary + '\n');
process.exit(0);
