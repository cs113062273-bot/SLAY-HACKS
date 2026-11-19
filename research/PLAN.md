# Veracite: project plan

**One line:** Drop in a paper, thesis, or student essay. Veracite reads every reference and every citing sentence in your browser. It proves each reference exists *as cited*, catches fabricated and hijacked citations, and checks whether each cited source actually supports the claim attached to it, showing the evidence sentence.

## Who it is for
- **Educators / TAs:** grading essays and theses in the age of LLM-written bibliographies.
- **Researchers:** pre-submission self-check, so you are not the next NeurIPS hallucination headline.
- **Reviewers / editors / conference chairs:** triage of submissions.
- **Students:** learning to cite responsibly.

## Why it wins (vs. every known tool)
| Capability | Existence checkers (RefChecker, Hallucinator, CheckIfExist, HalRef, HalluCiteChecker) | GPTZero | scite / Acurio / citefact | **Veracite** |
|---|---|---|---|---|
| Multi-source field-level cross-verification (title+authors+year+venue+ID → same record) | partial | partial | partial | **yes, with per-field diff** |
| Identifier-hijacking detection | rare | ? | no | **yes** |
| "Unverifiable ≠ fabricated" (software, standards, web, datasets, books) → fewer false positives | no (main failure) | ? | no | **yes, typed references** |
| Claim support with evidence sentence | no | weak, online only | paid LLM per source | **yes, in-browser model, free** |
| Retraction / correction notices | no | no | some | **yes (Crossref update-to)** |
| One-click corrected BibTeX | no | no | no | **yes** |
| Privacy: document never leaves the device | CLI only | no (cloud) | no | **yes** |
| Cost / setup | install, GROBID, keys | paid | paid | **free, zero install, web** |
| Published benchmark vs. competitors | n/a | disputed | no | **yes, on the same public data** |

## Architecture (all client-side; static hosting)
```
PDF / DOCX / text / BibTeX / arXiv ID
   │ pdf.js (layout-aware lines, columns, fonts)
   ▼
[1] Document model: body sentences + reference section
   │ reference segmentation (numbered / author-year / hanging indent)
   │ field parser (authors, year, title, venue, DOI, arXiv, URL, pages)
   ▼
[2] Resolver (multi-source, cached, rate-limited, backoff)
   DOI → doi.org/Crossref/DataCite · arXiv ID → S2/OpenAlex · free-text → Crossref bibliographic,
   OpenAlex, Semantic Scholar match, Europe PMC; candidate pool
   ▼
[3] Verifier: field-level alignment of reference ↔ each candidate
   title sim (token+char), author-set match (surname+initial, order, et al.), year (preprint drift),
   venue alias, ID consistency → identifier-hijack, placeholder/generic-name heuristics
   → calibrated scorer → VERIFIED | METADATA ERRORS(fields) | ID MISMATCH | LIKELY FABRICATED
     | NOT INDEXED (typed: software/web/standard/book/dataset) | RETRACTED flag
   ▼
[4] Citation linker: in-text markers ([3], [3–5], (Smith et al., 2020)) → references; citances
   ▼
[5] Claim-support engine
   claim normalization (split multi-cite, strip citation markers, decontextualize)
   source text: abstract (S2/OpenAlex/Crossref/EuropePMC) + OA full text (arXiv PDF, EuropePMC XML)
   evidence retrieval: BM25 + dense (bge-small, in-browser) hybrid → top-k sentences
   verifier: NLI/MiniCheck-style model (ONNX, transformers.js, WebGPU→WASM fallback), fine-tuned
   → SUPPORTED | PARTIAL | NOT SUPPORTED | CONTRADICTED | NO ACCESS (honest)
   ▼
[6] Report UI: integrity overview, reference table, document view with color-coded citances,
   evidence side panel, corrected BibTeX, Markdown/JSON report export
```
- Workers: PDF parsing and ML each run in a Web Worker; network work goes through a request scheduler (per-host concurrency + token bucket + IndexedDB cache).
- The same TypeScript core runs in Node for benchmarks (one codebase, no drift between product and eval).

## Evidence plan (claims must be measured)
1. **Existence/metadata:** run the core on the Zenodo 104-reference set (same inputs as the 5 tools) → recall/specificity/precision/F1 against their published outputs. Target: recall ≥ .90 with specificity ≥ .85 (best competitor: .61).
2. **Claim support:** Citation-Integrity test split (20 articles) → micro/macro-F1 vs. MultiVerS .59/.52 and GPT-4 .65/.45. Fine-tune a compact verifier on its train split (+ SciFact, HealthVer if license OK). Target: macro-F1 > .52 with a browser-sized model.
3. **Real-world stress:** P3 paper (13 NeurIPS hallucinations) end-to-end from PDF.

## Milestones
- M1 core engine (parse, resolve, verify) + Zenodo benchmark
- M2 web app UI (upload → report), PDF pipeline
- M3 claim-support model (train/eval/export ONNX) + in-browser integration
- M4 polish: design pass, samples, BibTeX fix, export, performance, README + docs
- M5 (after user approval only) deploy and prepare the demo/video
