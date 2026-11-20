/**
 * Every user-facing path in a fresh Chrome profile: cross-origin isolation, the three samples, PDF / DOCX /
 * BibTeX upload, pasted text, an arXiv ID, the quick → claim-support upgrade, and the three exports.
 * Usage: VERACITE_URL=https://<user>.github.io/<repo>/ npx tsx scripts/live-e2e.ts
 */
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Page } from 'puppeteer-core';

const base = process.env.VERACITE_URL ?? 'http://127.0.0.1:4181/SLAY-HACKS/';
const data = (p: string) => fileURLToPath(new URL(`../../data/${p}`, import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'veracite-live-'));
const dl = mkdtempSync(join(tmpdir(), 'veracite-dl-'));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: profile });
const bad: string[] = [];
const errs: string[] = [];
const results: any[] = [];
const watch = (page: Page) => {
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('response', (r) => r.status() >= 400 && new URL(r.url()).origin === new URL(base).origin && bad.push(`${r.status()} ${r.url()}`));
};
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (globalThis as any).__veracite?.();
    if (!s) return null;
    const v: Record<string, number> = {};
    for (const r of s.results) if (r) v[r.verdict] = (v[r.verdict] ?? 0) + 1;
    const c: Record<string, number> = {};
    for (const x of s.claims) c[x.label ?? x.status] = (c[x.label ?? x.status] ?? 0) + 1;
    return { phase: s.phase, claimPhase: s.claimPhase, mode: s.mode, refs: s.doc?.references.length ?? 0, done: s.results.filter(Boolean).length, v, c, error: s.error };
  });
async function until(page: Page, ok: (s: any) => boolean, minutes: number) {
  const t0 = Date.now();
  let s: any = null;
  while (Date.now() - t0 < minutes * 60000) {
    s = await state(page);
    if (s && (ok(s) || s.phase === 'error')) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { s, sec: Math.round((Date.now() - t0) / 1000) };
}
async function fresh(): Promise<Page> {
  const page = await browser.newPage();
  watch(page);
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.mode button');
  return page;
}

// 0. first visit: the COI service worker reloads once; then choose Quick check (remembered)
let page = await fresh();
await new Promise((r) => setTimeout(r, 3000));
await page.waitForSelector('.mode button');
const coi = await page.evaluate(() => (globalThis as any).crossOriginIsolated as boolean);
await page.click('.mode button:nth-child(2)');
await page.close();

const cases: [string, (p: Page) => Promise<void>, number][] = [
  ['sample-planted', async (p) => void (await p.goto(`${base}#sample-planted`), await p.reload()), 3],
  ['sample-neurips', async (p) => void (await p.goto(`${base}#sample-neurips`), await p.reload()), 3],
  ['sample-attention', async (p) => void (await p.goto(`${base}#sample-attention`), await p.reload()), 3],
  ['upload-pdf', async (p) => (await p.$('#file-input'))!.uploadFile(data('pdfs/resnet_1512.03385.pdf')), 8],
  ['upload-docx', async (p) => (await p.$('#file-input'))!.uploadFile(data('inputs/test.docx')), 4],
  ['upload-bib', async (p) => (await p.$('#file-input'))!.uploadFile(data('inputs/sample.bib')), 4],
  ['paste', async (p) => {
    await p.$eval('#paste-input', (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(el, 'References\n[1] Diederik P. Kingma and Jimmy Ba. Adam: A method for stochastic optimization. In ICLR, 2015.\n[2] Maria Lindqvist and Arjun Patel. Quantum-inspired gradient routing for sparse transformers. Nature Machine Intelligence, 4(2):112-125, 2022.');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const b = await p.evaluateHandle(() => [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Audit pasted text')));
    await (b as any).click();
  }, 4],
  ['arxiv-id', async (p) => {
    await p.type('#arxiv-input', '1706.03762');
    await p.keyboard.press('Enter');
  }, 8],
];
const only = process.env.ONLY?.split(",");
for (const [name, act, min] of cases.filter(([n]) => !only || only.includes(n))) {
  page = await fresh();
  const t0 = Date.now();
  await act(page);
  const { s } = await until(page, (x) => x.phase === 'done', min);
  results.push({ name, sec: Math.round((Date.now() - t0) / 1000), phase: s?.phase, mode: s?.mode, refs: s?.refs, verdicts: s?.v, error: s?.error });
  if (name === 'sample-planted') {
    // exports
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
    for (const k of [0, 1, 2]) {
      await page.click('.menu > .btn');
      await page.waitForSelector('.menu-pop button');
      await page.evaluate((i) => (document.querySelectorAll('.menu-pop button')[i] as HTMLElement).click(), k);
      await new Promise((r) => setTimeout(r, 1200));
    }
    const files = existsSync(dl) ? readdirSync(dl).map((f) => `${f} ${statSync(join(dl, f)).size}B`) : [];
    results.push({ name: 'exports', files });
  }
  if (name === 'sample-attention') {
    // quick → one click to claim support
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Check claim support'))?.click());
    const t1 = Date.now();
    const u = await until(page, (x) => ['done', 'unavailable'].includes(x.claimPhase), 12);
    results.push({ name: 'claim-upgrade', sec: Math.round((Date.now() - t1) / 1000), claimPhase: u.s?.claimPhase, claims: u.s?.c });
  }
  await page.close();
}
console.log(JSON.stringify({ base, crossOriginIsolated: coi, results, http4xx: bad, pageErrors: errs }, null, 1));
await browser.close();
process.exit(coi && !bad.length && !errs.length && results.every((r) => !r.phase || r.phase === 'done') ? 0 : 1);
