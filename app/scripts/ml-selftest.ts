/** Loads the in-browser models in real Chrome and prints load time, device and one prediction. */
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const logs: string[] = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 400)}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.failure()?.errorText} ${r.url().slice(0, 160)}`));
await page.goto(`http://localhost:4173/#ml-selftest${process.argv[2] ?? ''}`);
await page.waitForFunction(() => document.title === 'ML-OK' || document.title === 'ML-FAIL', { timeout: 15 * 60 * 1000 });
console.log(await page.title(), await page.evaluate(() => document.body.dataset.ml));
for (const l of logs.slice(0, 15)) console.log(l);
await browser.close();
