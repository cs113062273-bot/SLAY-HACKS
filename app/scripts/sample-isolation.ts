/** Regression: a sample's recorded responses must not answer a subsequent live input in the same tab. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const base = process.env.VERACITE_URL ?? 'http://127.0.0.1:4180/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  const requests: string[] = [];
  let live = false;
  page.on('request', (r) => {
    if (live && /api\.crossref\.org|api\.datacite\.org|api\.openalex\.org|api\.semanticscholar\.org|www\.ebi\.ac\.uk/.test(new URL(r.url()).hostname)) requests.push(r.url());
  });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.mode button');
  await new Promise((r) => setTimeout(r, 2000));
  await page.click('.mode button:nth-child(2)');
  await page.goto(`${base}#sample-attention`);
  await page.reload();
  await page.waitForFunction(() => (globalThis as any).__veracite?.().phase === 'done', { timeout: 180000 });
  const sample = await page.evaluate(() => {
    const s = (globalThis as any).__veracite();
    return { replayed: s.replayed, refs: s.doc.references.length, raw: s.doc.references[0].raw };
  });
  assert.equal(sample.refs, 40);
  assert.ok(sample.replayed);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'New audit')!.click());
  await page.waitForSelector('#paste-input');
  live = true;
  await page.$eval('#paste-input', (el, raw) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, `References\n${raw}`);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, sample.raw);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Audit pasted text'))!.click());
  await page.waitForFunction(() => (globalThis as any).__veracite?.().phase === 'done', { timeout: 180000 });
  const result = await page.evaluate(() => {
    const s = (globalThis as any).__veracite();
    return { replayed: s.replayed, refs: s.doc.references.length, verdict: s.results[0].verdict };
  });
  assert.equal(result.refs, 1);
  assert.equal(result.replayed, undefined);
  assert.ok(requests.length > 0, 'The live input was answered entirely by the recorded sample cache');
  console.log(JSON.stringify({ passed: true, base, sampleReferences: sample.refs, live: result, liveIndexRequests: requests.length, hosts: [...new Set(requests.map((u) => new URL(u).hostname))] }, null, 2));
} finally {
  await browser.close();
}
process.exit(0);
