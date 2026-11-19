# Veracite

**Citation integrity audit that runs in your browser.** Drop in a paper, thesis or BibTeX file. Veracite checks every reference against the scholarly record, catches fabricated, hijacked and misattributed citations, and tests whether each cited work supports the sentence that cites it. Every flag comes with its evidence.

Built for SLAY HACKS 2026.

## The problem

Large language models invent references, and the invented ones survive review:

- About 1 in 277 PubMed Central papers in early 2026 cited at least one fabricated reference, up from 1 in 2,828 in 2023 (Topaz et al., *The Lancet*).
- 100 fabricated citations appeared in 53 papers accepted at NeurIPS 2025, each paper reviewed by 3–5 experts (GPTZero; Ansari, arXiv:2602.05930). Every one combined several deceptions, such as a plausible title with real authors, or a valid arXiv ID pointing to a different paper.
- 39% of citations in an annotated biomedical corpus contained accuracy errors, from oversimplification to outright contradiction (Sarol et al., *Bioinformatics* 2024).

Existing checkers test whether a title exists. On a public benchmark of 104 manually verified references, the five leading tools falsely flag 20 to 53 of the 71 genuine references (Badalova & Mayr, arXiv:2607.22693). None of them checks whether the cited work says what the citing sentence claims.

## What Veracite does

1. **Reads the document.** It does layout-aware PDF parsing (two-column pages, running headers, appendices), isolates the reference section and splits it into entries. It links every in-text marker, numeric (`[3–7]`) or author–year (`Smith et al., 2020`), to its entry. DOCX, BibTeX, plain text and arXiv IDs are also accepted.
2. **Resolves each reference** against Crossref, DataCite, Semantic Scholar, OpenAlex and Europe PMC, plus GitHub and Hugging Face for software and models. Lookups are tiered: identifiers and Crossref first, and rate-limited indexes only when needed.
3. **Cross-verifies field by field.** Title, every author, year, venue and identifier must point to the *same* record. The candidate record is aligned back onto the raw reference string, so a weak parse doesn't break verification. This catches:
   - fabricated works
   - a real title with swapped or invented co-authors
   - wrong venues and years
   - DOIs or arXiv IDs that resolve to a different paper
   - preprints cited as published
   - near-miss titles, incomplete author lists, placeholder text and future dates
   - retracted works (Crossref update notices, OpenAlex)
4. **Checks claim support.** For each citing sentence it retrieves the most relevant passages from the cited abstract, or the open-access full text when available (arXiv). Retrieval is hybrid: BM25 plus e5 embeddings with reciprocal rank fusion. A fine-tuned verifier then classifies the claim as *supported*, *not supported* or *unrelated* and shows the passages it relied on.
5. **Reports and fixes.** The report gives a per-field diff against the published record and a suggested correction built from that record. Exports are an audit report (Markdown), a corrected bibliography (BibTeX) and full results (JSON).

## Results

### Reference verification: same 104 references the five leading tools were evaluated on

Badalova & Mayr (2026), Zenodo [10.5281/zenodo.21457492](https://doi.org/10.5281/zenodo.21457492). 33 problematic, 71 verified.

| Tool | Recall | Specificity | Precision | F1 |
|---|---|---|---|---|
| CheckIfExist | .939 | .521 | .477 | .633 |
| HalluCiteChecker | .545 | .718 | .474 | .507 |
| Hallucinator | .879 | .606 | .509 | .644 |
| HalRef | .727 | .254 | .312 | .436 |
| RefChecker | .970 | .493 | .471 | .634 |
| **Veracite** | **1.000** | **.972** | **.943** | **.971** |

Reproduce: `cd app && npx tsx scripts/bench-refs.ts`. The two remaining false positives are a workshop poster that no index covers and one entry whose cited co-authors do not match the paper. This set was used during development, so the held-out result below is the fairer test.

### Held-out: HALLMARK v1.2 `test_public` (scored once)

HALLMARK (Reizinger et al., arXiv:2607.18360) has 825 test citations: 526 hallucinated across 14 types, and 299 valid. Veracite was developed on a stratified sample of `dev_public` and run on `test_public` once. Published results on the same split:

| System | Paid LLM | Detection rate | FPR | F1 |
|---|---|---|---|---|
| Cascade: bibtex-updater + Claude Sonnet 4.6 agent | yes | .990 | .033 | **.986** |
| **Veracite** (in-browser, free indexes, no LLM) | no | .949 | .054 | **.959** |
| Claude Sonnet 4.6 | yes | .919 | .158 | .916 |
| Claude Opus 4.7 | yes | .895 | .184 | .895 |
| bibtex-updater | no | .835 | .074 | .890 |
| GPT-5.4 | yes | .774 | .221 | .815 |

Veracite is the strongest system that needs no paid LLM, and it beats every LLM evaluated on its own. One paid agentic cascade scores higher. During this run, OpenAlex's free daily allowance was exhausted, so Veracite ran with one index fewer than usual.

Per type: perfect on fabricated DOIs, future dates, hybrid fabrications, merged citations, placeholder authors, plausible fabrications and preprint-as-published. Weakest on nonexistent venues (26/37) and near-miss titles (34/40). Reproduce: `cd app && npx tsx scripts/bench-hallmark.ts --split test_public`.

### Unseen papers from six fields

To check behaviour on papers the code had never seen, six arXiv preprints posted after development started were audited end to end from the PDF (cs.CY, econ.GN, physics.soc-ph, q-bio.PE, q-fin.GN, stat.AP; numeric and author-year styles, 17 to 85 pages, 351 references in total). Every flag was judged by hand against the publisher's record.

| | First run | Final run |
|---|---|---|
| References flagged as a problem | 95 | 7 |
| Of which confirmed real citation errors | 5 | 6 |
| Marked *unverifiable* or *unchecked* (not flagged) | 90 | 65 |

The six real errors are a wrong arXiv ID, a wrong DOI (`…087` cited for `…099`), a DOI that is not registered anywhere, two one-word title changes and a reference that drops two of its authors. The sixth error (the dropped authors) was missed in the first run because an index did not answer. The seventh flag is a conference talk cited under a different title from the one in the index, which is arguable. Most first-run false alarms came from reference styles the parser did not yet handle (economics "Author, Year, Title", Springer "Author: Title", family-name-first initials, line-broken DOIs) and from books matched to their reviews. These were fixed with general rules and checked against the two benchmarks above after each change (Zenodo F1 still .971, HALLMARK dev F1 .986). Of the 65 references that were not confirmed, 52 are in the physics paper, which cites 19th-century laws and archival periodicals that no scholarly index covers. They are reported as *unverifiable* rather than fabricated. Because these six papers were then used to fix bugs, they no longer count as unseen. Output: `data/unseen_audit1.txt` (first run) and `data/unseen_audit10.txt` (final run); reproduce with `cd app && npx tsx scripts/audit-pdfs.ts ../data/pdfs/unseen/*.pdf`.

Five well-known papers were also used as clean controls during development. They cover single- and two-column layouts and numeric, author-year and Vancouver styles:

| Paper | Layout, style | References | Verified | Flagged |
|---|---|---|---|---|
| Attention Is All You Need (2017) | 1-column, numeric | 40 | 40 | 0 |
| BERT (NAACL 2019) | ACL 2-column, author-year | 56 | 53 | 1 |
| ResNet (CVPR 2016) | CVPR 2-column, numeric | 50 | 48 | 2 |
| Semantic Uncertainty (ICLR 2023) | 1-column, author-year | 46 | 45 | 0 |
| Bioinformatics survey (PLOS) | Vancouver | 32 | 32 | 0 |

The three flags are a workshop paper indexed under its host conference (BERT) and two real discrepancies in ResNet's bibliography: a title with an extra word, and a 2008 citation of software whose paper appeared in 2010. Before the two-column fix, BERT's reference list was read across both columns and showed 13 flags. ResNet showed 12 flags before fixes for hyphenated initials ("T.-Y. Lin"), journal acronyms (TPAMI, IJCV) and conference papers whose only indexed record is the later journal version. These papers are development data, not a held-out test.

### Claim support: Citation-Integrity (Sarol et al., 2024), test split

The shipped browser model (DeBERTa-v3-base, 4-bit, 102 MB) uses top-5 hybrid-retrieved evidence. Published systems use a GPU or a paid API:

| System | Micro-F1 | Macro-F1 | Accurate F1 | Not accurate F1 | Unrelated F1 |
|---|---|---|---|---|---|
| MultiVerS, Longformer 435M (paper's best) | .59 | **.52** | .69 | **.43** | .42 |
| GPT-4, in-context | **.65** | .45 | **.80** | .09 | .48 |
| **Veracite (in-browser)** | .634 | .486 | .768 | .152 | **.538** |

Veracite beats the paper's best model on micro-F1 and on recognising accurate and unrelated citations. It is weaker on subtle "not substantiated" errors, a class where GPT-4 also fails. The interface is built around that measured profile, so it never shows "not substantiated" as a verdict:

- **Supported** when P(accurate) ≥ 0.5. Precision is .93 on SemanticCite (8 fields, held out) and .75 on Citation-Integrity dev.
- **Needs review** when P(not accurate or unrelated) ≥ 0.98. Across fields this flags 8% of supported and 41% of unsupported citations.
- **Inconclusive** otherwise, with the evidence passages still shown. Citations that only name a method or give an example are labelled **Mention** and are not judged.

How the test split was used: the shipped model was chosen on dev and then scored on test. Later a retrained variant (adding perturbed claims and 12k MNLI pairs) scored much higher on dev (macro .577 vs .480; paired bootstrap 95% CI +.036 to +.156), but lower on the cross-field SemanticCite set (.817 vs .837). It was briefly shipped and scored on test: micro .609, macro .456. It was then withdrawn, because our pre-set rule required both dev and SemanticCite to improve. The test split has therefore now been scored for two models, so .486 is no longer a single-shot number. The lesson we drew is that our 255-row dev set no longer predicts held-out gains, so we stopped training.

Training data: Citation-Integrity train + SciFact, with evidence counts randomised between 2 and 6 so a short abstract does not break the model. Retrieval is BM25 + e5-small-v2 with reciprocal rank fusion. On dev it reaches R@5 .36 against .31 for the paper's BM25+MonoT5. 4-bit weight-only quantization and vocabulary pruning (128k → 45k pieces) leave dev accuracy unchanged (macro-F1 .525 vs .523 fp32). Dynamic int8 quantization, by contrast, broke the model (.11), because it quantizes activations inside DeBERTa's disentangled attention.

## Responsible use

- **Private by design.** Documents never leave the device. Only reference strings are sent to public scholarly indexes. Models run in the browser.
- **Evidence, not verdicts.** Every flag shows the record it was compared with, the fields that differ and the sources consulted. "Not indexed" (websites, standards, software) is kept separate from "fabricated" to avoid accusing authors of what an index simply doesn't cover. When a major index doesn't respond, Veracite says so rather than calling a reference fabricated.
- **Honest about coverage.** Claim checks label whether they used the abstract or the full text. A claim the abstract doesn't support may still be supported in the full paper, and the interface says so.

## Network, privacy and cost

Veracite is a static site. There is no Veracite server, account, database or API key. Everything below was checked in a fresh Chrome profile with `app/scripts/privacy-audit.ts`, which records every request the page makes.

| Host | What is sent | Why |
|---|---|---|
| the site itself | nothing (downloads only) | app, the two models (e5-small-v2 34 MB and the verifier 102 MB, cached after the first visit) and the ONNX Runtime WASM |
| `api.crossref.org`, `api.datacite.org` | reference title/authors, DOIs | metadata lookup, retraction notices |
| `doi.org` (handle API) | a DOI that no metadata index knows | tells a DOI registered with a smaller agency apart from one that does not exist |
| `api.semanticscholar.org`, `api.openalex.org` | reference title, DOI or arXiv ID | broad-coverage lookup, abstracts |
| `www.ebi.ac.uk` (Europe PMC) | reference title or DOI | biomedical records, open-access full text |
| `api.github.com`, `huggingface.co` | repository / model ID from a cited URL | software and model references |
| `arxiv.org` | arXiv ID | the sample papers, and full text of cited arXiv papers |

- **Only GET requests, and only bibliographic strings.** The audit found no POST requests. It also slid a 7-word window over every sentence of the document body and found none of them in any URL or request body.
- **Free tiers only.** All indexes are used anonymously within their free limits. The optional OpenAlex and Semantic Scholar keys (Settings) are the user's own. They are stored in that browser's `localStorage` only and never leave it except to those two hosts. The repository and the built site contain no credentials.
- **Graceful degradation.** Every host has per-host concurrency limits, retries with backoff, honours `Retry-After`, and has a circuit breaker. If OpenAlex reports a spent daily allowance it is switched off for the session; nothing is ever paid for automatically. A reference whose indexes did not answer is reported as *unchecked* (never as fabricated) and can be re-checked with one click. Claim checking runs fully offline once the models are cached.
- **No GPU needed.** Inference runs on WebAssembly (multi-threaded when the page is cross-origin isolated, which a small service worker arranges). WebGPU is not required.

## Speed and the two modes

**Quick check** verifies the references only and never downloads the models. **Full audit** also checks claim support. References always stream into the report first, and claim results follow one by one. After a quick check, one click starts claim support on the same document.

Measured with `app/scripts/mode-e2e.ts` on the *Attention Is All You Need* sample: 40 references, 56 claim checks. Setup: headless Chrome 157, Intel i7-12700H laptop (no GPU used), production build served locally. Times include downloading the models from the local server, but not over the internet. On a 50 Mbit/s line the 136 MB model download adds about 22 s once.

| Run | References done | First claim result | All 56 claims |
|---|---|---|---|
| Quick check, fresh profile | 3.4 s (no model requests) | 14.5 s after clicking *Check claim support* | 178 s after the click |
| Full audit, fresh profile (cold) | 3.4 s | 84 s | 261 s |
| Full audit, same profile (warm: models and cited full texts cached) | 2.2 s | | 136 s |

The sample replays recorded index responses (see above). A live paper's reference check depends on how fast the indexes respond; the blind test reports live, uncached times. With Chrome's CPU throttled 4×, a stand-in for a low-end laptop, 30 references took 98 s and 32 claim checks took 7.8 minutes. Claim checks run one after another on the CPU, at about 2.4 s each on this laptop when warm. The labels were identical in all three runs.

## Run locally

```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in app/dist, deployable to any static host
```

Deep links: `#sample-planted`, `#sample-neurips`, `#sample-attention`, `#arxiv-<id>`.

Optional free API keys for OpenAlex and Semantic Scholar (Settings) make large reference lists faster. Veracite works without them.

### Training the claim verifier (optional)

```bash
cd ml
python -m venv .venv && .venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cu126
.venv/Scripts/pip install transformers sentencepiece accelerate rank_bm25 scikit-learn "optimum[onnxruntime]"
python build_contexts.py          # retrieval contexts identical to the browser's
python train_verifier.py --model MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli --k 5 --out runs/base
python export_onnx.py --run runs/base --out ../app/public/models/veracite-verifier
```

## Architecture

```
app/src/core      parse.ts (reference parser) · doc.ts (PDF lines → references, citances) · pdf.ts (pdf.js)
                  sources.ts (index adapters) · http.ts (per-host limits, backoff, cache) · verify.ts (alignment, verdicts)
                  bibtex.ts · bm25.ts · text.ts (fuzzy matching)
app/src/engine    session.ts (pipeline + store) · claims.ts (evidence retrieval + verification) · ml.worker.ts (transformers.js)
app/src/ui        Landing · Report · exports
app/scripts       bench-refs.ts · bench-hallmark.ts · build-seeds.ts
ml/               Citation-Integrity loader, retrieval experiments, verifier training, ONNX export
```

The same TypeScript core runs in the browser and in Node, so every benchmark number measures the shipped code.

## Data and licenses

Benchmarks: Badalova & Mayr reference set (Zenodo), HALLMARK (MIT), Citation-Integrity (ScienceNLP-Lab), SciFact (CC BY-NC 2.0, training only). Metadata comes from Crossref, DataCite, OpenAlex (CC0), Semantic Scholar and Europe PMC. Sample papers are fetched from arXiv at run time, not redistributed.
