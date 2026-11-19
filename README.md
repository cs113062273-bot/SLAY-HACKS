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

### Claim support: Citation-Integrity (Sarol et al., 2024), test split scored once

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

Training data: Citation-Integrity train + SciFact, with evidence counts randomised between 2 and 6 so a short abstract does not break the model. Retrieval is BM25 + e5-small-v2 with reciprocal rank fusion. On dev it reaches R@5 .36 against .31 for the paper's BM25+MonoT5. 4-bit weight-only quantization and vocabulary pruning (128k → 45k pieces) leave dev accuracy unchanged (macro-F1 .525 vs .523 fp32). Dynamic int8 quantization, by contrast, broke the model (.11), because it quantizes activations inside DeBERTa's disentangled attention.

## Responsible use

- **Private by design.** Documents never leave the device. Only reference strings are sent to public scholarly indexes. Models run in the browser.
- **Evidence, not verdicts.** Every flag shows the record it was compared with, the fields that differ and the sources consulted. "Not indexed" (websites, standards, software) is kept separate from "fabricated" to avoid accusing authors of what an index simply doesn't cover. When a major index doesn't respond, Veracite says so rather than calling a reference fabricated.
- **Honest about coverage.** Claim checks label whether they used the abstract or the full text. A claim the abstract doesn't support may still be supported in the full paper, and the interface says so.

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
