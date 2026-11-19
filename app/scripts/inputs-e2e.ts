/** Browser check of the paste, arXiv-URL and BibTeX input paths. Usage: npx tsx scripts/inputs-e2e.ts (preview on 127.0.0.1:4180) */
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const base = process.env.VERACITE_URL ?? 'http://127.0.0.1:4180/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const PASTE = `References
[1] Kaiming He, Xiangyu Zhang, Shaoqing Ren, and Jian Sun. Deep residual learning for image recognition. In CVPR, 2016.
[2] Tomas Mikolov, Kai Chen, Greg Corrado, and Jeffrey Dean. Efficient estimation of word representations in vector space. arXiv:1301.3781, 2013.
[3] Diederik P. Kingma and Jimmy Ba. Adam: A method for stochastic optimization. In ICLR, 2016.
[4] Maria Lindqvist and Arjun Patel. Quantum-inspired gradient routing for sparse transformers. Nature Machine Intelligence, 4(2):112-125, 2022.`;
async function run(name: string, act: (p: puppeteer.Page) => Promise<void>, minutes = 6) {
  const page = await browser.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.goto(base);
  await page.waitForSelector('#paste-input');
  const t0 = Date.now();
  await act(page);
  let st: any = null;
  while (Date.now() - t0 < minutes * 60000) {
    await new Promise((r) => setTimeout(r, 1000));
    st = await page.evaluate(() => {
      const s = (globalThis as any).__veracite?.();
      if (!s) return null;
      const v: Record<string, number> = {};
      for (const r of s.results) if (r) v[r.verdict] = (v[r.verdict] ?? 0) + 1;
      return { phase: s.phase, refs: s.doc?.references.length, v, error: s.error, issues: s.results.map((r: any) => r && `${r.verdict}: ${r.issues[0] ?? ''}`.slice(0, 120)) };
    });
    if (st && (st.phase === 'done' || st.phase === 'error')) break;
  }
  console.log(name, ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify({ phase: st?.phase, refs: st?.refs, v: st?.v, error: st?.error }), errs.length ? errs : '');
  if (name === 'paste') console.log(st?.issues);
  await page.close();
}
await run('paste', async (p) => {
  await p.$eval('#paste-input', (el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, PASTE);
  const btn = await p.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Audit pasted text')));
  await (btn as any).click();
});
await run('arxiv-url', async (p) => {
  await p.type('#arxiv-input', 'https://arxiv.org/abs/1810.04805');
  await p.keyboard.press('Enter');
}, 10);
await run('bibtex', async (p) => {
  await ((await p.$('#file-input')) as any).uploadFile(fileURLToPath(new URL('../../data/inputs/sample.bib', import.meta.url)));
});
await browser.close();
