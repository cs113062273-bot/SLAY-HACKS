/** Post-deploy smoke test: page loads, cross-origin isolation (multi-threaded WASM) is active, no 404s,
 * a sample (default: Attention, 56 claims) runs end to end in full mode including claim support.
 * Usage: VERACITE_URL=https://<user>.github.io/<repo>/ npx tsx scripts/deploy-check.ts */
import puppeteer from 'puppeteer-core';
const base = process.env.VERACITE_URL ?? 'http://127.0.0.1:4181/SLAY-HACKS/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const errs: string[] = [];
const bad: string[] = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('response', (r) => r.status() >= 400 && new URL(r.url()).origin === new URL(base).origin && bad.push(`${r.status()} ${r.url()}`));
await page.goto(base, { waitUntil: 'networkidle2' });
await page.waitForSelector('.mode button');
// the COI service worker reloads the page once on first visit
await new Promise((r) => setTimeout(r, 3000));
const coi = await page.evaluate(() => (globalThis as any).crossOriginIsolated as boolean);
await page.click('.mode button:nth-child(1)'); // full audit
await page.goto(`${base}#${process.env.SAMPLE ?? "sample-attention"}`);
await page.reload();
const t0 = Date.now();
let s: any = null;
while (Date.now() - t0 < 10 * 60000) {
  s = await page.evaluate(() => {
    const st = (globalThis as any).__veracite?.();
    return st && { phase: st.phase, claimPhase: st.claimPhase, refs: st.doc?.references.length, flagged: st.results.filter((r: any) => r && ['fabricated', 'id_mismatch', 'metadata_error', 'retracted'].includes(r.verdict)).length, claims: st.claims.length, labelled: st.claims.filter((c: any) => c.label).length };
  });
  if (s && s.phase === 'done' && ['done', 'unavailable'].includes(s.claimPhase)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(JSON.stringify({ base, crossOriginIsolated: coi, state: s, seconds: Math.round((Date.now() - t0) / 1000), http4xx: bad, pageErrors: errs }, null, 1));
await browser.close();
process.exit(coi && s?.phase === 'done' && s?.claimPhase === 'done' && !bad.length && !errs.length ? 0 : 1);
