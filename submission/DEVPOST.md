# Veracite: Devpost submission text

Paste each section into the matching Devpost field.

---

## Project name
Veracite

## Tagline (≤ 200 characters)
A free citation-integrity audit that runs in your browser. It catches fabricated and misattributed references and checks whether each cited work supports the claim, showing the evidence each time.

## Try it
- **Live demo:** https://cs113062273-bot.github.io/SLAY-HACKS/. No account, no install, no API key. Click a sample on the right, or drop in a PDF, Word file, BibTeX file or arXiv ID.
- **Source:** https://github.com/cs113062273-bot/SLAY-HACKS
- Validated on desktop Chrome. The first full audit downloads 136 MB of models once; **Quick check** skips it.
- For a fast first check, choose **Reference list with planted errors**. Choose **Attention Is All You Need**, then **Check claim support**, to inspect the local AI and its evidence; the first full audit can take several minutes.

---

## Inspiration

In early 2026, about 1 in 277 PubMed Central papers cited at least one reference that does not exist, ten times the 2023 rate (Topaz et al., *The Lancet*). One hundred fabricated citations passed peer review into 53 papers accepted at NeurIPS 2025, each read by three to five expert reviewers. None of these were obvious fakes. Every one combined several deceptions: real authors on an invented title, or a valid arXiv ID that leads to a different paper.

We looked at the tools researchers and teachers actually have. On a public benchmark of 104 hand-verified references, the five best-known checkers wrongly flag between 20 and 53 of the 71 genuine ones (Badalova & Mayr, 2026). A tool that cries wolf that often gets ignored. And none of them asks the second question a reviewer cares about: **does the cited paper actually say what the sentence claims?** About 39% of citations in an annotated biomedical corpus get that wrong (Sarol et al., 2024).

We wanted a tool a supervisor, reviewer or student could open in a browser tab before submitting, without uploading a manuscript anywhere and without paying for it.

## What it does

Drop in a paper (PDF, DOCX, BibTeX, pasted text or an arXiv ID). Veracite:

1. **Reads the document.** It parses two-column PDFs, finds the reference list and links every in-text citation, numeric or author–year, to its entry.
2. **Checks every reference against the scholarly record**: Crossref, OpenAlex, Semantic Scholar, DataCite and Europe PMC (INSPIRE-HEP for physics), plus GitHub and Hugging Face for software and models.
3. **Cross-verifies field by field.** The title, every author, year, venue and identifier must all point to *the same* record. This is what catches a hijacked DOI, swapped co-authors, a preprint cited as a journal paper, a near-miss title or a retracted work.
4. **Separates "unverifiable" from "fabricated".** Websites, standards, software and old books that no index covers are labelled as such and never counted as fabrications.
5. **Checks claim support.** For each citing sentence it retrieves the most relevant passages of the cited work and runs a fine-tuned verifier. It shows those passages and labels the claim *Supported*, *Needs review* or *Inconclusive*.
6. **Fixes what it can.** A per-field diff against the published record, a suggested correction, one-click corrected BibTeX, and Markdown / JSON audit reports.

There are two modes: **Quick check** (references only) and **Full audit** (references, then claim support). Results stream in as they arrive.

## How we built it

- **Fully client-side.** A static React 19 + TypeScript site (Vite). There is no server, database or account. Browser and Node evaluations share the same TypeScript core; frozen commits and separate current regressions make the results reproducible.
- **PDF understanding.** pdf.js text runs are rebuilt into lines with column-gutter detection, rotated-text filtering and running-header removal. A reference parser handles numbered, author–year, Vancouver, Springer and economics styles, hyphenated initials and DOIs broken across lines.
- **Resolution and verification.** Tiered lookups start with identifiers and Crossref, then move to rate-limited indexes only when needed. Each candidate record is aligned back onto the raw reference string, field by field, and the record that agrees with the most cited fields wins. Per-host concurrency, backoff, `Retry-After`, a circuit breaker and IndexedDB caching keep it inside every free tier.
- **Claim support model.** We started from DeBERTa-v3-base (NLI) and fine-tuned it on Citation-Integrity and SciFact, with the number of evidence passages randomised so that short abstracts don't break it. We then pruned the vocabulary (128k → 45k pieces) and applied 4-bit weight-only quantization: 102 MB, with dev accuracy unchanged. It runs in ONNX Runtime WebAssembly, multi-threaded through a small cross-origin-isolation service worker. No GPU is needed.
- **Evidence retrieval.** BM25 plus e5-small-v2 embeddings, combined with reciprocal rank fusion, over the abstract or the open-access full text. On Citation-Integrity dev it reaches R@5 .36, against .31 for the paper's BM25 + MonoT5.
- **Calibrated output.** The model's "not accurate" class alone is close to chance, so the interface never shows it as a verdict. Thresholds were set using Citation-Integrity dev and SemanticCite: *Supported* at P(accurate) ≥ .5 (calibration precision .93 on SemanticCite across 8 fields) and *Needs review* at P(not accurate or unrelated) ≥ .98. SemanticCite also informed model selection, so this is not an independent new-paper estimate. Every other claim is labelled *Inconclusive*, and the evidence is still shown.

## Results (all reproducible from the repository)

| Benchmark | Veracite | Best comparison |
|---|---|---|
| 104 hand-verified references (Badalova & Mayr 2026) | **F1 .971**, 2 of 71 genuine references flagged | Hallucinator F1 .644 (28 of 71 flagged) |
| HALLMARK v1.2 test, 825 citations, historical held-out run | **F1 .959**, no LLM | Claude Sonnet 4.6 alone .916; paid agent cascade .986 |
| Citation-Integrity claim support, test split | macro-F1 .486, micro .634, in the browser | MultiVerS (GPU) .52 / .59; GPT-4 .45 / .65 |
| Blind test 1: 14 new papers from 14 fields, code frozen, every flag checked by hand | 635 references: 80% confirmed, 4 labelled real errors, **87 false alarms (13.7% of references)**, 0 misses in a random sample of 42 | n/a (no published tool has been run on these papers) |
| Blind test 2: 14 more papers from 12 further fields, after the fixes | 465 references: 77.8% verified, 7 real errors, 54 false alarms (11.6% of references), 2 uncertain flags; 0/41 sampled misses | n/a |
| Blind test 3: 14 more papers from 12 further fields plus PLOS ONE, code frozen | every PDF yielded its reference list; 964 of 969 entries found; **81.1% verified**; 1 real error, 2 uncertain, 98 false alarms (**10.2%** of references; median paper 3.7%); 0/42 sampled misses; field accuracy on 70 sampled references: year 100%, venue 91%, authors 89%, title 86% | n/a |

## Challenges we ran into

- **False alarms are the real enemy, and benchmarks hide them.** On clean benchmark strings we flag 2 of 71 genuine references. On real PDFs it is different. Our first run on six unseen papers flagged 95 references, and only 5 were real errors. So we stopped trusting anything we had already looked at. Three times we froze the code, picked 14 brand-new papers by a rule fixed in code before opening any, ran once, and judged every flag by hand. False alarms went from 13.7% to 11.6% to 10.2% of references, against a 2% target we have not met. Each round moved the bottleneck. First it was parsing (title words read as authors, years glued onto titles, REVTeX lists with no heading). In round 3, extraction was solved (no failed PDF, 99.5% of entries found). The rest was field conventions: two physics papers produced 70 of the 98 false alarms ("JHEP", LaTeX math in arXiv titles, collaboration names), while the other twelve papers were at 4.3%. Real-world citation style is a long tail, and we publish every flag with our judgement of it.
- **Free APIs fail in interesting ways.** Crossref's throttle responses carry no CORS headers, so they look like network errors. OpenAlex's anonymous allowance is a daily dollar budget. A service-worker reload on first visit interrupted IndexedDB and made every lookup hang. Each one is now handled, and a reference whose indexes did not answer is shown as *unchecked*, never as fabricated.
- **Shrinking a 700 MB model to run in a browser tab.** Dynamic int8 quantization destroyed DeBERTa (macro-F1 .49 → .11), because it quantizes activations inside the disentangled attention. 4-bit weight-only quantization kept accuracy intact.
- **Being honest with ourselves.** A retrained verifier looked clearly better on our dev set (+.10 macro-F1, statistically significant), but failed our preset cross-field selection rule. We briefly shipped it and also scored the test split, where it was worse. We restored the model required by the original selection rule and disclose the extra test exposure in the README. No further model selection uses that test.

## Accomplishments that we're proud of

- The lowest false-alarm rate on the public reference benchmark: 2 genuine references flagged out of 71, where the published tools flag 20 to 53. On brand-new papers the rate was much higher (13.7%, 11.6% and 10.2% of references in three frozen blind tests), and we publish those numbers with every flag and our judgement of it.
- Three pre-registered blind audits of 42 real papers from 36 arXiv categories and PLOS ONE, 2,064 references, every flag checked by hand with a source link. Frozen outputs are never edited.
- The strongest system without a paid LLM on the held-out HALLMARK test, ahead of every LLM evaluated on its own.
- Claim checking with evidence, running privately on the reader's own laptop.
- A production privacy audit of a three-reference DOCX with two claim tasks: zero non-GET requests and no matches for five contiguous seven-word body windows in observed requests. Bibliographic metadata reaches public indexes; the audit's scope is documented in `VALIDATION.md`.

## What we learned

Precision matters more than recall for a tool like this: one wrong accusation costs more trust than one missed typo. The hardest part of citation checking is not search but deciding *when two records are the same work*, and before that, reading the reference correctly out of a PDF. A small dev set stops predicting held-out results sooner than you expect, and only a frozen blind test on papers nobody has looked at tells you how the tool behaves for a stranger.

## What's next

- Per-sentence claim checks against full text for more publishers through Europe PMC and Unpaywall.
- A reviewer mode that audits a batch of submissions and exports one table.
- Independent field-accuracy evaluation of the newly added REVTeX and AMS parser support.
- A browser extension for Overleaf and Google Docs.

## Limitations (disclosed)

- Claim support is weakest on subtle misrepresentation ("not substantiated"), a class where GPT-4 also fails. That is why the interface never states that verdict.
- False alarms on new papers: the frozen blind sets had 87/635 (13.7%), 54/465 (11.6%) and 98/964 (10.2%), far above our 2% target. Fixes made after the third set and a later systemic pass bring the three sets to about 1.0–1.5%, but they were used to write the fixes, so this is not an independent result. Each flag shows the record it was compared with and the fields that differ, so a reader can dismiss a false alarm quickly, but it is still a false alarm.
- Separately numbered supplementary bibliographies are not included in the main-bibliography audit.
- Papers that cite with superscript numbers (common in AIP physics journals) get reference checks but no claim checks.
- Coverage depends on public indexes. Archival, regional and very old literature is often *unverifiable*, and is reported that way.
- Sample papers replay index responses recorded on 2026-11-19 so the demo is fast and repeatable. Each sample uses an isolated cache. Uploads use live indexes and may reuse actual prior lookup responses from that browser, never the recorded sample snapshot.
- The verifier was trained on SciFact (CC BY-NC 2.0), so the model is for non-commercial use.

## Built with
typescript, react, vite, pdf.js, onnxruntime-web, transformers.js, webassembly, deberta-v3, e5-small-v2, pytorch, hugging-face, crossref, openalex, semantic-scholar, datacite, europe-pmc, github-pages
