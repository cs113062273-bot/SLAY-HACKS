/** Showcase screenshots for the Devpost gallery (3:2, 1500×1000). Usage: npx tsx scripts/shots.ts (preview on 127.0.0.1:4180) */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const base = process.env.VERACITE_URL ?? 'http://127.0.0.1:4180/';
const out = '../submission/shots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const st = () => page.evaluate(() => (globalThis as any).__veracite?.());
const wait = async (ok: (s: any) => boolean, min = 10) => {
  const t0 = Date.now();
  while (Date.now() - t0 < min * 60000) {
    const s = await st();
    if (s && ok(s)) return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timeout');
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clickRow = (i: number) => page.evaluate((k) => (document.querySelectorAll('.list .row')[k] as HTMLElement).click(), i);
const open = async (hash: string, mode: 'full' | 'quick') => {
  await page.goto(base);
  await page.waitForSelector('.mode button');
  await page.click(`.mode button:nth-child(${mode === 'full' ? 1 : 2})`);
  await page.goto(`${base}#${hash}`);
  await page.reload();
};

// 1. landing
await page.goto(base);
await page.waitForSelector('.mode button');
await page.click('.mode button:nth-child(1)');
await pause(800);
await page.screenshot({ path: `${out}/1-landing.png` });

// 2–3. NeurIPS preprint: a fabricated reference, then a hijacked identifier
await open('sample-neurips', 'quick');
let s = await wait((x) => x.phase === 'done');
const fab = s.results.findIndex((r: any) => r?.verdict === 'fabricated');
const idm = s.results.findIndex((r: any) => r?.verdict === 'id_mismatch');
await clickRow(fab);
await pause(600);
await page.screenshot({ path: `${out}/2-fabricated.png` });
await clickRow(idm);
await pause(600);
await page.screenshot({ path: `${out}/3-wrong-identifier.png` });

// 4. corrected details for a metadata error
const md = s.results.findIndex((r: any) => r?.verdict === 'metadata_error');
await clickRow(md);
await pause(600);
await page.screenshot({ path: `${out}/4-wrong-details.png` });

// 5. planted list: a retracted paper cited as if it were sound
await open('sample-planted', 'quick');
s = await wait((x) => x.phase === 'done');
const ret = s.results.findIndex((r: any) => r?.verdict === 'retracted');
if (ret >= 0) {
  await clickRow(ret);
  await pause(600);
  await page.screenshot({ path: `${out}/5-retracted.png` });
}

// 6–7. claim support on Attention (full audit)
await open('sample-attention', 'full');
s = await wait((x) => x.claimPhase === 'done', 15);
await page.evaluate(() => (document.querySelectorAll('.tabs [role=tab]')[1] as HTMLElement).click());
await pause(400);
// rows are sorted (needs review, supported, …) once checks finish: click by the row's position in that order
const rank = (c: any) => (c.label ? ({ review: 0, supported: 1, unclear: 2, mention: 4 } as any)[c.label] : c.status === 'no_source' ? 3 : 2);
const order = s.claims.map((c: any, i: number) => ({ c, i })).sort((a: any, b: any) => rank(a.c) - rank(b.c) || a.i - b.i);
const pos = (i: number) => order.findIndex((x: any) => x.i === i);
const supported = s.claims.map((c: any, i: number) => ({ c, i })).filter(({ c }: any) => c.label === 'supported' && s.doc.citances[c.citanceId].refIndices.length === 1);
supported.sort((a: any, b: any) => b.c.probs.ACCURATE - a.c.probs.ACCURATE);
if (process.env.VERBOSE) for (const { c } of supported) console.log(`SUPPORTED p=${c.probs.ACCURATE.toFixed(2)} | ${s.doc.citances[c.citanceId].claim.slice(0, 140)}
   EV: ${c.evidence[0]?.text.slice(0, 160)}`);
if (process.env.VERBOSE) for (const c of s.claims.filter((c: any) => c.label === 'review')) console.log(`REVIEW | ${s.doc.citances[c.citanceId].claim.slice(0, 140)}
   EV: ${c.evidence[0]?.text.slice(0, 160)}`);
const claimOf = (x: any) => s.doc.citances[x.c.citanceId].claim as string;
const sup = pos((supported.find((x: any) => /memory network/i.test(claimOf(x))) ?? supported[0]).i);
await clickRow(sup);
await pause(600);
await page.screenshot({ path: `${out}/6-claim-supported.png` });
const rev = s.claims.findIndex((c: any) => c.label === 'review');
if (rev >= 0) {
  await clickRow(pos(rev));
  await pause(600);
  await page.screenshot({ path: `${out}/7-claim-review.png` });
}

// 8. dark mode
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await clickRow(sup);
await pause(600);
await page.screenshot({ path: `${out}/8-dark.png` });
await browser.close();
console.log('ok');
process.exit(0);
