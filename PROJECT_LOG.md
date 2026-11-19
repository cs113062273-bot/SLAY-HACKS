# PROJECT LOG: SLAY HACKS 2026 (Veracite)

Read this first in any new session. Details are in research/competition_and_landscape.md and research/PLAN.md.

## Status (2026-11-19)
- Direction: **Veracite**, an in-browser citation-integrity auditor (reference existence + field-level cross-verification + claim support). Deadline Dec 7, 2026 5pm EST.
- Web app (app/, Vite + React 19 + TS) builds and runs end to end: PDF/DOCX/BibTeX/text/arXiv input → references verified → report UI with field diff, corrections, exports. Deep links: `#sample-planted`, `#sample-neurips`, `#sample-attention`, `#arxiv-<id>`.
- Claim-support stage is wired (claims.ts, ml.worker.ts) but the verifier model (`public/models/veracite-verifier`) is not trained/exported yet.

## Layout
- app/src/core: parse.ts (reference parser), text.ts (fuzzy), http.ts (retry/backoff/cache), sources.ts (Crossref/OpenAlex/S2/DataCite/EuropePMC/GitHub/HF), verify.ts (alignment + verdicts), doc.ts (PDF lines → refs, citances), pdf.ts (pdf.js), bm25.ts
- app/src/engine: session.ts (store/orchestrator), inputs.ts, claims.ts, ml.worker.ts, mlClient.ts, models.ts, claimConfig.ts, idbCache.ts
- app/src/ui: Landing, Report, Settings, exporters, labels
- app/scripts: bench-refs.ts (Zenodo benchmark vs 5 tools), pdf-test.ts, parse-test.ts; cache in data/cache/http.json
- ml/: ci_data.py, retrieval.py, build_contexts.py, train_verifier.py; venv at ml/.venv (CUDA torch)

## Key decisions
- Fully client-side static site (zero cost, privacy). Same TS core runs in Node for benchmarks.
- Tiered retrieval: identifiers + Crossref first; S2/OpenAlex (rate-limited anonymously) only if unsettled.
- Candidate choice = record agreeing with most cited fields (fixes Crossref re-deposit duplicates).
- Non-scholarly refs (web/standards/software) → "Not indexed" unless GitHub/HF can verify; not flagged.
- Claim model is trained on the same retrieval the browser uses (BM25 + bge-small, RRF).

## Best results
- Zenodo 104-ref benchmark (Badalova & Mayr 2026), `npx tsx scripts/bench-refs.ts`: run 1 F1 .784 → run 4 **Recall 1.000, Spec .972, Prec .943, F1 .971** (best prior tool: Hallucinator F1 .644). Remaining 2 FPs: unindexed workshop poster (P2 R3), probable label error (P3 R18).
  Caveat: developed against this set (generic fixes), so HALLMARK test_public is the held-out evaluation.
- Evidence retrieval on Citation-Integrity dev: e5-small-v2 + BM25 (RRF) R@5 .36 / R@20 .62 vs paper BM25+MonoT5 R@5 .31 / R@20 .55 (paper on test).
- Verifier: DeBERTa-v3-base-mnli-fever-anli, k=5 → dev macro-F1 .485 raw / .504 bias-tuned (paper MultiVerS test .52, GPT-4 .45).

## Held-out benchmark: HALLMARK v1.2 (data/hallmark, arXiv:2607.18360)
- test_public 825 (526 halluc / 299 valid). Published: cascade bibtex-updater+Claude Sonnet 4.6 F1 .986 (paid LLM), Sonnet 4.6 alone .916, bibtex-updater (free) .890 DR .835 FPR .074, GPT-5.4 .815.
- Protocol: develop on dev_public (stratified sample), score test_public once. `npx tsx scripts/bench-hallmark.ts --split dev_public --per-type 15 --valid 100 --verbose`

- HALLMARK dev_public stratified sample (15/type + 100 valid): v1 F1 .951 → v3 .978 → v5 **DR .971 FPR .000 F1 .986**.
- **HALLMARK test_public (held out, run ONCE, 2026-11-19): DR .949 FPR .054 P .969 F1 .959** (data/hm_test.txt). Ranks 2nd of all published systems: only the paid cascade bibtex-updater+Claude Sonnet 4.6 agent (.986) is higher; beats Sonnet 4.6 alone (.916), Opus 4.7 (.895), bibtex-updater (.890), GPT-5.4 (.815). OpenAlex budget was exhausted during the run. Do NOT tune on test; later code changes are validated on dev + Zenodo only.
- Real papers (clean controls): Attention 40/40 verified; Kuhn (ICLR) all verified except SEP encyclopedia → "not indexed"; PLOS (Vancouver) parses 32/32.
- Claim triage calibration (shipped model, CI dev, ml/calib.py): Supported P(acc)≥.5 → precision .83; Needs review P(nacc+nei)≥.8 → precision .76; NOT_ACCURATE alone precision .25–.29 (≈ chance) → never shown as a verdict. UI labels: Supported / Needs review / Inconclusive.
- Browser: WebGPU inference flaky (buffer mapping errors) → WASM default, auto-fallback kept. Custom COI service worker (public/coi-serviceworker.js, only rewrites document + worker responses) → cross-origin isolated → 4 WASM threads: 0.53 s/claim.
- **Final verifier = runs/deb_base_sf_k26** (CI train + SciFact, evidence count 2–6): dev .523 (q4 .525), SemanticCite AUROC .837 (not trained on it), probes 3/4. Shipped via `ml/ship.sh` (prune min_count 3 → 45k pieces, 4-bit) = 102.2 MB.
- **CI test (once, shipped q4 model): micro .634 macro .486**; per class ACC .768 / NOT_ACC .152 / NEI .538 (MultiVerS .59/.52, GPT-4 .65/.45).
- Final triage thresholds (claimConfig.ts): supported P(acc)≥.5; review P(nacc+nei)≥.98 (flags 8% supported vs 41% unsupported on SemanticCite); multi-cite (≥3 refs) only if NEI≥.98; mention citations not judged.
- Clean-paper e2e (Attention): 40/40 refs verified; 76 claims in <8 min; 3 of 67 labelled claims flagged.
- Per-reference time budget 40 s in browser (VerifyContext.budgetMs); benchmarks run without budget.
- Claim verifier generalization: SemanticCite held-out 30% (sup vs unsup) AUROC: CI-trained base .801, zero-shot NLI .706.
- Browser model: 4-bit weight-only MatMulNBits + int8 Gather = 214 MB, dev macro-F1 .487 (= fp32 .485). Runs on WebGPU in Chrome (load 39 s first time, 3 s first inference). `#ml-selftest` deep link + scripts/ml-selftest.ts.

## Failed approaches / gotchas
- Fine-tuned MiniLM evidence reranker on CI gold evidence made retrieval worse (dev R@5 .29 vs zero-shot .35): evidence labels too noisy (κ .2–.37). Kept hybrid retrieval.
- OpenAlex anonymous tier = $0.10/day budget; once spent, 429 forever → Http disables host for the session.
- Crossref holds re-deposits of famous papers under unrelated publishers (Attention 2025 "Shenzhen…") → pickBest by field agreement.
- ORT dynamic int8 quantization destroys DeBERTa-v3 (macro-F1 .49 → .11; activation×activation MatMuls in disentangled attention, activation outliers). Weight-only 4-bit fixes it.
- transformers.js v4 skips local model probe if env.localModelPath is an absolute URL → use pathname.
- k=10 evidence worse than k=5 (.43 vs .49). Verifier trained on fixed k=5 fails with 1 evidence sentence (format artifact) and confuses contradiction with NEI → retraining with k∈[1,7] + SciFact + SemanticCite (runs/deb_base_all).
- Crossref throttles browser bursts; throttle responses lack CORS headers (appear as network errors) → concurrency 2 + shared host cooldown.
- arXiv papers get renamed between versions: same identifier + same authors + different title = renamed (minor), not hijack.
- Benchmarks disagree on given-name errors (Zenodo: verified; HALLMARK: hallucinated) → kept minor.
- Zenodo CSV is CP850-encoded and lost curly quotes/dashes ("?"); bench-data.ts repairs these.
- new URL(...).pathname keeps %20; use fileURLToPath.
- DBLP is behind a bot wall; arXiv export API has no CORS (use DataCite 10.48550/arXiv.ID instead).

## Next steps (as of 2026-11-19)
1. Deploy: needs the user's GitHub account (repo + Pages via .github/workflows/pages.yml; model file 102 MB = 97 MiB < 100 MiB limit). Not a git repo yet; never commit without the user's go-ahead.
2. After deploy: run scripts/e2e.ts against the live URL; check Firefox/Edge.
3. Untested paths: DOCX upload (mammoth).
4. Possible improvements (validate on dev/Zenodo only; HALLMARK test is spent): nonexistent_venue (26/37 on test), near-miss plural/hyphen titles, claim recall.
5. Demo video / Devpost text only after user approval (SKILL.md req. 11).
