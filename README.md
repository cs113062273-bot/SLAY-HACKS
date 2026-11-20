# Veracite

**Citation integrity audit that runs in your browser.** Drop in a paper, thesis or BibTeX file. Veracite checks every reference against the scholarly record, catches fabricated, hijacked and misattributed citations, and tests whether each cited work supports the sentence that cites it. Every flag comes with its evidence.

Built for SLAY HACKS 2026.

Try [Veracite on GitHub Pages](https://cs113062273-bot.github.io/SLAY-HACKS/). Freeze `497cb22` deployed successfully on November 20. Production acceptance evidence is recorded in `submission/VALIDATION.md`. Local setup is below.

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

On the public reference benchmarks, Veracite outperformed the evaluated free baselines. Frozen end-to-end PDF audits were weaker: false alarms were 87/635 references (13.7%) in set 1 and 54/465 (11.6%) in set 2. Those errors informed later fixes, so neither set now independently evaluates the current parser. A third audit is pre-registered in `data/blind3/PROTOCOL.md`. Benchmark provenance matters: Zenodo and HALLMARK dev were rechecked on the current core; HALLMARK test .959 is a historical held-out run, and claim-model results concern the retained model described below.

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

### Historical held-out result: HALLMARK v1.2 `test_public` (scored once)

HALLMARK (Reizinger et al., arXiv:2607.18360) has 825 test citations: 526 hallucinated across 14 types, and 299 valid. Veracite was developed on a stratified sample of `dev_public` and run on `test_public` once. Published results on the same split:

| System | Paid LLM | Detection rate | FPR | F1 |
|---|---|---|---|---|
| Cascade: bibtex-updater + Claude Sonnet 4.6 agent | yes | .990 | .033 | **.986** |
| **Veracite** (in-browser, free indexes, no LLM) | no | .949 | .054 | **.959** |
| Claude Sonnet 4.6 | yes | .919 | .158 | .916 |
| Claude Opus 4.7 | yes | .895 | .184 | .895 |
| bibtex-updater | no | .835 | .074 | .890 |
| GPT-5.4 | yes | .774 | .221 | .815 |

Among these evaluated systems, the historical Veracite run has the highest F1 without a paid LLM and exceeds each standalone LLM result. One paid agentic cascade scores higher. During this run, OpenAlex's free daily allowance was exhausted, so Veracite ran with one index fewer than usual.

Per type: perfect on fabricated DOIs, future dates, hybrid fabrications, merged citations, placeholder authors, plausible fabrications and preprint-as-published. Weakest on nonexistent venues (26/37) and near-miss titles (34/40). Reproduce: `cd app && npx tsx scripts/bench-hallmark.ts --split test_public`.

### Blind test: 14 new papers from 14 fields, code frozen

The benchmarks above were used, at least in part, while the code was being developed. To measure what a stranger would see, 14 papers were chosen by a rule fixed in code before any of them was opened (`app/scripts/pick-blind.ts`: the newest paper in each of 12 arXiv categories never used during development, plus the two newest PLOS ONE research articles). They were audited once, from the PDF, with the code frozen (commit `15daf9d`; reference-checking code identical to `79fa273`). Every flag, and a random sample of confirmed references, was then checked by hand against the publisher's record.

| | Blind test 1 |
|---|---|
| Fields | cs.CL, cs.CV, cs.SE, cs.HC, astro-ph.GA, cond-mat.mtrl-sci, quant-ph, math.PR, q-bio.NC, eess.SP, econ.EM, stat.ME, PLOS ONE ×2 (psychology, public health) |
| PDFs tried / reference list extracted | 18 / 14. Four physics PDFs (REVTeX/AIP) gave no references and were replaced by the next paper, as the rule specifies |
| References | 635 |
| Confirmed (coverage) | 506 (79.7%) |
| Flagged as a problem | 92 (14.5%) |
| of which real citation errors | 4, plus 1 uncertain (corrected adjudication) |
| of which false alarms | **87 (13.7% of all references)** |
| *Unverifiable* (not indexed: web pages, datasets, legal texts) | 24 (3.8%) |
| *Unchecked* (an index did not answer) | 13 (2.0%) |
| Misses: errors among 42 randomly sampled confirmed references | 0 (95% upper bound about 7%) |
| Time per paper, live, no cache | median 101 s (24 s to 16 min); six papers ran at once against rate-limited free APIs |

These frozen PDF results are weaker than the clean-string benchmarks. Four references remain labelled as real errors: a wrong year, two omitted authors without et al., a title that is not the official one, and a title that differs from its arXiv record (the last two were labelled too severely). The original manual count was 5 real / 86 false. Re-review of the original PDF page 18 showed that all four authors of the Pillow et al. reference were present; the extractor had dropped them. Corrected counts are 4 real / 87 false / 1 uncertain, precision 4.3%. The frozen outputs are unchanged; evidence and the correction overlay are in `data/blind/REVIEW_CORRECTIONS.md` and `review-corrections.json`. False-alarm causes:

| Cause | False alarms |
|---|---|
| Author line lost during extraction (manual label corrected after PDF review) | 1 |
| Words of the title or venue, or "arXiv", read as author names | 29 |
| PDF text artefacts: lost symbols (τ, CO₂, R̂), accents, hyphenation, a title cut at "?" | 12 |
| A year glued onto the title | 9 |
| The work exists but was not found (six while Semantic Scholar and OpenAlex were rate-limiting; three not indexed) | 9 |
| The index record differs harmlessly (an arXiv version title, a 3rd edition matched to the 1st, translators listed as authors, a misspelt 1944 record, an arXiv year for a journal paper) | 6 |
| Venue mis-parsed (5) or abbreviated (3) | 8 |
| AAS astronomy style, two-column text mixed into one reference | 6 |
| Other (a year in the title read as the publication year, a DOI split across lines, two wrong matches, a truncated entry) | 7 |

Two real papers (Lewis et al. 2020 on retrieval-augmented generation, and the GDPR) were labelled *fabricated* while an index was down. Crossref answered HTTP 429 963 times and Semantic Scholar 412 times during the run, because six papers ran at once; a single user checking one paper causes far fewer. Every flag, with the record it was compared with and our judgement, is in `data/blind/results.json`; the miss sample is `data/blind/miss_sample.txt`. Reproduce with `cd app && npx tsx scripts/blind-test.ts`.

**After blind test 1.** Each failure class was fixed with a general rule (commits `3f1aad6` and `532c978`): parsing debris is no longer counted as an author; years glued onto titles, text that runs past the title, symbols lost in extraction and a title cut at "?" no longer count as title changes; a DOI that the matched record's DOI extends is treated as cut off; a "wrong identifier" is not reported when the record's full title is written in the reference; journal abbreviations of words such as "Association" are recognised; *fabricated* now requires both broad indexes (Semantic Scholar and OpenAlex) to have answered, otherwise the reference is *not found* or *unchecked*; and reference lists without a heading (REVTeX, AIP) are now found. None of this changed any benchmark result (Zenodo F1 .971, HALLMARK dev F1 .986, identical flags on the 11 development papers). The heading-less lists were fixed using only the four failed PDFs of blind test 1. As an independent check, the seven PDFs that blind set 2 had to skip for the same reason (never opened before) were parsed once after the fix: all seven now yield their reference lists (15 to 58 references each). Blind test 1 itself cannot measure the fixes, because it was used to find the problems. A second blind set (14 papers from 12 further fields, selected before anything was run on it: `data/blind2/manifest.json`) completed at commit `61f1844`. Its unchanged frozen results are below.

### Blind test 2 and current parser regression

| Metric | Frozen set 2 |
|---|---|
| Candidate PDFs / extracted papers | 21 / 14; seven zero-reference PDFs were replaced under the original selection rule |
| Extracted references | 465 |
| Verified coverage | 362/465 (77.8%) |
| Flags | 63: 7 real errors, 54 false alarms, 2 uncertain |
| Flag precision | 7/63 (11.1%); uncertain flags remain in the denominator |
| False alarms / all extracted references | 54/465 (11.6%); this is not a conditional false-positive rate |
| Unverifiable / unchecked | 23 (4.9%) / 17 (3.7%) |
| Sampled misses | 0/41 verified references; not evidence of zero misses overall |
| Live verification time | median 74 seconds per paper, range 54–157 seconds |

Artifacts: `data/blind2/results.json`, `miss_sample.txt`, `manifest.json`. The frozen set measured the earlier code; subsequent development regressions are not blind results.

The parser development manifest contains 38 PDF files representing **37 distinct papers** (one cross-listed arXiv paper appeared twice). Before deduplication, count completeness was 1890/1896 (99.7%). Deduplicated count completeness is **1833/1839 (99.7%)**, with no zero-reference PDFs. Field-health rates are no author 0.9%, no year 1.1%, debris author 3.3%; output is in `data/parser_dev/freeze-eval-unique.txt`; these are development measurements and missing-field/debris heuristics, not independently judged field accuracy. Some APS references omit titles in the source, so “no title” alone is not an error.

On the 25 papers in spent sets 1 and 2 with available source/JATS counts, current count completeness is 693/706 (98.2%) and 477/479 (99.6%), compared with the original 599/706 (84.8%) and 359/479 (74.9%). Counts are capped per paper and several source counts are only citation-key approximations. In particular, `cond-mat.mtrl-sci_2611.24759v1.pdf` has main labels [1]–[90] plus a separate supplement; its 103-key estimate mixes scopes. `gr-qc_2611.25786v1.pdf` has 32 labels, including explanatory note [19]; the parser returns 31 bibliographic entries. We retain these denominator discrepancies rather than treating them as proven parser errors or changing them to obtain a better score. The product currently audits the main bibliography, not separately numbered supplementary bibliographies.

### Development papers from six fields

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
- **Samples and live inputs are separate.** Recorded sample responses use an in-memory cache limited to that sample audit. A later upload in the same tab cannot use those recorded responses. Live inputs use public indexes and may reuse actual responses previously obtained in that browser's persistent cache.
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

The sample replays recorded index responses (see above). A live paper's reference check depends on how fast the indexes respond: in blind test 1 (live, no cache, six papers at once against rate-limited free APIs) a paper took a median 101 s, from 24 s for 13 references to 16 minutes for 90 references under heavy Crossref throttling. References appear one by one as they are checked, so the first results show within seconds. With Chrome's CPU throttled 4×, a stand-in for a low-end laptop, 30 references took 98 s and 32 claim checks took 7.8 minutes. Claim checks run one after another on the CPU, at about 2.4 s each on this laptop when warm. The labels were identical in all three runs.

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

The browser and Node evaluations share the same TypeScript core. Historical frozen results measure the commits recorded with those runs; they do not automatically describe later parser changes.

## Data and licenses

Benchmarks: Badalova & Mayr reference set (Zenodo), HALLMARK (MIT), Citation-Integrity (ScienceNLP-Lab), SciFact (CC BY-NC 2.0, training only). Metadata comes from Crossref, DataCite, OpenAlex (CC0), Semantic Scholar and Europe PMC. Sample papers are fetched from arXiv at run time, not redistributed.
