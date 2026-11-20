/**
 * Privacy + network audit in real Chrome with a fresh profile (cold start).
 * Uploads a document through the file input, records every request (method, host, body) and checks that
 * no sentence of the document body leaves the browser. Also reports timings.
 * Usage: npx tsx scripts/privacy-audit.ts <file> [minutes] [--offline-after-parse] [--throttle-cpu 4]
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const file = process.argv[2];
const minutes = Number(process.argv[3] ?? 10);
const offline = process.argv.includes('--offline-after-parse');
const ti = process.argv.indexOf('--throttle-cpu');
const throttle = ti > 0 ? Number(process.argv[ti + 1]) : 0;
const profile = mkdtempSync(join(tmpdir(), 'veracite-profile-'));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: profile });
const page = await browser.newPage();
if (throttle) await (await page.createCDPSession()).send('Emulation.setCPUThrottlingRate', { rate: throttle });
const reqs: { method: string; url: string; body: string; t: number }[] = [];
const t0 = Date.now();
page.on('request', (r) => reqs.push({ method: r.method(), url: r.url(), body: r.postData() ?? '', t: Date.now() - t0 }));
await page.goto(process.env.VERACITE_URL ?? 'http://127.0.0.1:4180/');
await page.waitForSelector('#file-input');
await new Promise((r) => setTimeout(r, 1500)); // service worker registration + one-time reload
await page.waitForSelector('#file-input');
const tUpload = Date.now();
await ((await page.$('#file-input')) as any).uploadFile(file);
const marks: Record<string, number> = {};
let offlineSet = false;
while (Date.now() - tUpload < minutes * 60_000) {
  await new Promise((r) => setTimeout(r, 1000));
  const st = await page.evaluate(() => {
    const s = (globalThis as any).__veracite?.();
    if (!s) return null;
    const done = s.claims.filter((c: any) => c.status === 'done' || c.status === 'no_source').length;
    return { phase: s.phase, refsDone: s.results.filter(Boolean).length, refs: s.doc?.references.length ?? 0, claimPhase: s.claimPhase, claims: s.claims.length, claimsDone: done, model: s.modelProgress };
  });
  if (!st) continue;
  const el = (Date.now() - tUpload) / 1000;
  if (st.refs && marks.parsed === undefined) marks.parsed = el;
  if (offline && st.refs && !offlineSet) {
    await page.setOfflineMode(true);
    offlineSet = true;
  }
  if (st.phase === 'done' && marks.refs === undefined) marks.refs = el;
  if (st.model >= 1 && marks.model === undefined) marks.model = el;
  if (st.claimPhase === 'running' && marks.claimsStart === undefined) marks.claimsStart = el;
  if ((st.claimPhase === 'done' || st.claimPhase === 'unavailable') && marks.claims === undefined) {
    marks.claims = el;
    break;
  }
  if (st.phase === 'error') {
    marks.error = el;
    break;
  }
}
const final = await page.evaluate(() => {
  const s = (globalThis as any).__veracite?.();
  if (!s) return null;
  const v: Record<string, number> = {};
  for (const r of s.results) if (r) v[r.verdict] = (v[r.verdict] ?? 0) + 1;
  const c: Record<string, number> = {};
  for (const x of s.claims) {
    const k = x.label ?? x.status;
    c[k] = (c[k] ?? 0) + 1;
  }
  return { phase: s.phase, claimPhase: s.claimPhase, verdicts: v, claims: c, error: s.error, sentences: (s.doc?.sentences ?? []) as string[], refs: s.doc?.references.length };
});
// leakage check: does any 7-word window of any body sentence appear in any request?
const haystack = reqs.map((r) => decodeURIComponent(r.url.replace(/\+/g, ' ')) + ' ' + r.body).join('\n').toLowerCase();
let leaks = 0;
let windowsChecked = 0;
const probes: string[] = [];
for (const s of final?.sentences ?? []) {
  const w = s.toLowerCase().split(/\s+/).filter(Boolean);
  for (let i = 0; i + 7 <= w.length; i++) {
    const frag = w.slice(i, i + 7).join(' ');
    windowsChecked++;
    if (frag.length > 30 && haystack.includes(frag)) {
      leaks++;
      if (probes.length < 3) probes.push(frag);
    }
  }
}
const hosts: Record<string, number> = {};
for (const r of reqs) {
  const h = new URL(r.url).host;
  hosts[h] = (hosts[h] ?? 0) + 1;
}
const nonGet = reqs.filter((r) => r.method !== 'GET' && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
const passed = final?.phase === 'done' && ['done', 'unavailable'].includes(final?.claimPhase) && !final?.error && windowsChecked > 0 && !nonGet.length && !leaks;
console.log(JSON.stringify({ passed, file: file.split(/[\\/]/).pop(), throttle, offline, marks, final: { phase: final?.phase, claimPhase: final?.claimPhase, verdicts: final?.verdicts, claims: final?.claims, refs: final?.refs, error: final?.error }, hosts, nonGet: nonGet.map((r) => `${r.method} ${r.url.slice(0, 80)}`), windowsChecked, bodySentencesLeaked: leaks, leakSamples: probes }, null, 1));
await browser.close();
process.exit(passed ? 0 : 1);
