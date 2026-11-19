/** Upload a file through the real file input and print the verdicts. */
import puppeteer from 'puppeteer-core';
const file = process.argv[2];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:4173/');
await page.waitForSelector('#file-input');
const input = (await page.$('#file-input'))!;
await (input as any).uploadFile(file);
const t0 = Date.now();
while (Date.now() - t0 < 4 * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 3000));
  const st = await page.evaluate(() => {
    const s = (globalThis as any).__veracite?.();
    return s ? { phase: s.phase, error: s.error, verdicts: s.results.map((r: any) => r ? [r.verdict, r.issues.join(' / ').slice(0, 160), r.sourcesFailed.join(',')] : null), n: s.doc?.references.length } : null;
  });
  if (st && (st.phase === 'done' || st.phase === 'error')) {
    console.log(JSON.stringify(st));
    break;
  }
}
await browser.close();
