/**
 * End-to-end check in a real Chrome: open a deep link, wait for the audit and claim checks,
 * report console errors and save screenshots. Usage: npx tsx scripts/e2e.ts "#sample-attention" out-prefix
 */
import puppeteer from 'puppeteer-core';

const hash = process.argv[2] ?? '#sample-planted';
const out = process.argv[3] ?? 'e2e';
const url = `${process.env.VERACITE_URL ?? 'http://127.0.0.1:4180/'}${hash}`;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--window-size=1440,1000'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const logs: string[] = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && !/api.crossref|Failed to load resource/.test(m.text()) && logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
await page.goto(url);
const t0 = Date.now();
let last = '';
while (Date.now() - t0 < (Number(process.env.E2E_MIN) || 15) * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 5000));
  const status = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('.ledger section')].map((s) => (s as HTMLElement).innerText.replace(/\s+/g, ' '));
    return secs.join(' || ');
  });
  if (status !== last) {
    console.log(`${Math.round((Date.now() - t0) / 1000)}s ${status.slice(0, 260)}`);
    last = status;
  }
  if (/CLAIM SUPPORT/i.test(status) && !/Loading the verifier|Checked \d+ of|Starts when|Waiting|Checking \d+ of/i.test(status) && /verified/i.test(status)) break;
}
console.log('FINAL', last.slice(0, 400));
await page.screenshot({ path: `${out}-report.png` });
// open the claims tab and the first claim
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.tabs button')].find((b) => b.textContent?.startsWith('Claims')) as HTMLElement | undefined;
  tab?.click();
});
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => (document.querySelector('.list .row') as HTMLElement | null)?.click());
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${out}-claim.png` });
const dump = await page.evaluate(() => {
  const st = (globalThis as any).__veracite?.();
  if (!st) return [];
  return st.claims.filter((c: any) => c.label).map((c: any) => ({ label: c.label, ref: c.refIndex + 1, marker: st.doc.citances[c.citanceId].marker, claim: st.doc.citances[c.citanceId].claim, nrefs: st.doc.citances[c.citanceId].refIndices.length, title: st.results[c.refIndex]?.match?.title, src: c.sourceKind, p: c.probs, ev: c.evidence[0]?.text }));
});
const fs = await import('node:fs');
fs.writeFileSync(`${out}-claims.json`, JSON.stringify(dump, null, 1));
console.log('claims dumped:', dump.length);
console.log('console problems:', logs.length);
const uniq = [...new Set(logs.map((l) => l.slice(0, 220)))];
for (const l of uniq.slice(0, 30)) console.log(l);
const notes = await page.evaluate(() => [...document.querySelectorAll('.list .row small')].map((e) => (e as HTMLElement).innerText).slice(0, 8));
console.log('row notes:', JSON.stringify(notes));
await browser.close();
