/** Browser check of the two audit modes on a fresh profile (cold cache).
 * quick: references only, no model download; then "Check claim support" runs the claim stage on demand.
 * full: references then claims automatically. Records wall-clock timings for both.
 * Usage: npx tsx scripts/mode-e2e.ts [sample-attention] (preview on 127.0.0.1:4180) */
import puppeteer from 'puppeteer-core';
const base = process.env.VERACITE_URL ?? 'http://127.0.0.1:4180/';
const sample = process.argv[2] ?? 'sample-attention';
const shots = process.env.SHOTS ?? '../data/shots';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

type Snap = { phase: string; claimPhase: string; mode: string; refs: number; resolved: number; claims: number; claimsDone: number; labels: Record<string, number> };
const snap = (p: puppeteer.Page) =>
  p.evaluate(() => {
    const s = (globalThis as any).__veracite?.();
    if (!s) return null;
    const labels: Record<string, number> = {};
    for (const c of s.claims) if (c.label || c.status === 'no_source') labels[c.label ?? 'no_source'] = (labels[c.label ?? 'no_source'] ?? 0) + 1;
    return { phase: s.phase, claimPhase: s.claimPhase, mode: s.mode, refs: s.doc?.references.length ?? 0, resolved: s.results.filter(Boolean).length, claims: s.claims.length, claimsDone: s.claims.filter((c: any) => c.status === 'done' || c.status === 'no_source').length, labels } as Snap;
  });
async function until(p: puppeteer.Page, ok: (s: Snap) => boolean, minutes: number) {
  const t0 = Date.now();
  let s: Snap | null = null;
  while (Date.now() - t0 < minutes * 60000) {
    s = await snap(p);
    if (s && ok(s)) return s;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout; last state ${JSON.stringify(s)}`);
}

async function runMode(mode: 'quick' | 'full') {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  const modelReqs: string[] = [];
  page.on('request', (r) => /\/models\/|\.onnx|\.wasm/.test(r.url()) && modelReqs.push(r.url()));
  await page.goto(base);
  await page.waitForSelector('.mode button');
  await page.click(`.mode button:nth-child(${mode === 'full' ? 1 : 2})`);
  if (mode === 'quick') await page.screenshot({ path: `${shots}/landing-modes.png` });
  const t0 = Date.now();
  await page.goto(`${base}#${sample}`);
  await page.reload(); // hash-only navigation does not reload; the app reads the hash on load
  const refsDone = await until(page, (s) => s.phase === 'done', 6);
  const tRefs = Date.now() - t0;
  const out: Record<string, unknown> = { mode, refs: refsDone.refs, refsMs: tRefs, stateAtRefsDone: refsDone.claimPhase };
  if (mode === 'quick') {
    await new Promise((r) => setTimeout(r, 1500));
    out.modelRequestsBeforeClick = modelReqs.length;
    out.claimPhaseBeforeClick = (await snap(page))!.claimPhase;
    await page.screenshot({ path: `${shots}/quick-report.png` });
    const btn = await page.waitForSelector('.claim-offer .btn');
    const t1 = Date.now();
    await btn!.click();
    const first = await until(page, (s) => s.claimsDone > 0 || s.claimPhase === 'done' || s.claimPhase === 'unavailable', 15);
    out.firstClaimMs = Date.now() - t1;
    const done = await until(page, (s) => s.claimPhase === 'done' || s.claimPhase === 'unavailable', 20);
    out.claimsMs = Date.now() - t1;
    out.claims = done.claims;
    out.labels = done.labels;
    out.finalClaimPhase = done.claimPhase;
    void first;
  } else {
    const first = await until(page, (s) => s.claimsDone > 0 || s.claimPhase === 'done' || s.claimPhase === 'unavailable', 15);
    out.firstClaimMs = Date.now() - t0;
    const done = await until(page, (s) => s.claimPhase === 'done' || s.claimPhase === 'unavailable', 20);
    out.allClaimsMs = Date.now() - t0;
    out.claims = done.claims;
    out.labels = done.labels;
    out.finalClaimPhase = done.claimPhase;
    void first;
    // warm: same profile, models now cached
    const t2 = Date.now();
    await page.reload();
    await until(page, (s) => s.phase === 'done', 6);
    out.warmRefsMs = Date.now() - t2;
    const w = await until(page, (s) => s.claimPhase === 'done' || s.claimPhase === 'unavailable', 20);
    out.warmAllClaimsMs = Date.now() - t2;
    out.warmClaimPhase = w.claimPhase;
  }
  out.modelRequests = modelReqs.length;
  out.pageErrors = errs;
  await browser.close();
  return out;
}

const which = process.env.MODES?.split(',') ?? ['quick', 'full'];
for (const m of which) console.log(JSON.stringify(await runMode(m as 'quick' | 'full')));
