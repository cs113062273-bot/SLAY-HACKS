# How Veracite compares

Every number below is from a public source, measured on the same data. Features are listed only where the tool's own documentation or a cited evaluation states them.

## Accuracy on shared benchmarks

### Reference verification: Badalova & Mayr (2026), 104 manually verified references

Five checkers, published results (arXiv:2607.22693, Zenodo 10.5281/zenodo.21457492). Veracite ran on the same 104 references.

| Tool | Recall | Specificity | Precision | F1 | Genuine references falsely flagged |
|---|---|---|---|---|---|
| CheckIfExist | .939 | .521 | .477 | .633 | 34 of 71 |
| HalluCiteChecker | .545 | .718 | .474 | .507 | 20 of 71 |
| Hallucinator | .879 | .606 | .509 | .644 | 28 of 71 |
| HalRef | .727 | .254 | .312 | .436 | 53 of 71 |
| RefChecker | .970 | .493 | .471 | .634 | 36 of 71 |
| **Veracite** | **1.000** | **.972** | **.943** | **.971** | **2 of 71** |

Caveat: this set was also used during development, and it supplies clean reference strings. On brand-new papers read from PDF in three frozen blind tests, false alarms were 87/635 (13.7%), 54/465 (11.6%) and 98/964 (10.2%) of extracted references; see docs/EVALUATION.md. The five tools above were not run on those papers, so no comparison is claimed there.

### Hallucinated-citation detection: HALLMARK v1.2 `test_public`, 825 citations, held out

Published results from Reizinger et al. (arXiv:2607.18360). The historical Veracite test run was scored once; later parser changes were checked on dev only.

| System | Needs a paid LLM | Detection rate | False-positive rate | F1 |
|---|---|---|---|---|
| bibtex-updater + Claude Sonnet 4.6 agent | yes | .990 | .033 | .986 |
| **Veracite** | **no** | .949 | .054 | .959 |
| Claude Sonnet 4.6 | yes | .919 | .158 | .916 |
| Claude Opus 4.7 | yes | .895 | .184 | .895 |
| bibtex-updater | no | .835 | .074 | .890 |
| GPT-5.4 | yes | .774 | .221 | .815 |

Among the systems in this table, Veracite scores highest without a paid LLM. One paid agent cascade scores higher.

### Claim support: Citation-Integrity test split (Sarol et al., *Bioinformatics* 2024)

| System | Runs where | Micro-F1 | Macro-F1 |
|---|---|---|---|
| MultiVerS (Longformer, 435M) | GPU | .59 | .52 |
| GPT-4, in-context | paid API | .65 | .45 |
| **Veracite** | **in the browser, 102 MB** | .634 | .486 |

The rows are not on the same labels (our loader counted unsupported ETIQUETTE citations as "unrelated", the paper as "not accurate"), so they do not rank the systems. Veracite is weaker than MultiVerS on macro-F1. It is the only one of the three that runs on the reader's own device. The test split has been scored for two Veracite models (see README).

## Capabilities

| | Existence checkers (CheckIfExist, Hallucinator, HalRef, HalluCiteChecker, RefChecker) | GPTZero Hallucination Check | scite | **Veracite** |
|---|---|---|---|---|
| Checks that a reference exists | yes | yes | n/a | yes |
| Checks every field (title, each author, year, venue, ID) against the same record | partial | not documented | n/a | **yes, with a per-field diff** |
| Detects a DOI / arXiv ID that resolves to a different paper | rare | not documented | n/a | **yes** |
| Separates *unverifiable* (software, standards, books, archives) from *fabricated* | no; this is the main false-alarm source in Badalova & Mayr | not documented | n/a | **yes** |
| Checks whether the cited work supports the citing sentence | no | no | classifies citation context, not support | **yes, with the evidence passage** |
| Retraction notices | no | no | yes | yes (Crossref, OpenAlex) |
| Corrected BibTeX built from the published record | no | no | no | **yes** |
| Document stays on the user's device | CLI tools: yes | no (cloud upload) | no | **yes** |
| Cost and setup | install; some need GROBID or API keys | paid tiers | paid tiers | **free, no account, no install** |

"Not documented" means we found no public statement either way; it does not mean the feature is absent.

### Research systems from 2026 that use an LLM

Three further checkers were published in 2026. Each checks whether a reference exists and whether its metadata is faithful; none of their papers describes checking whether the cited work supports the citing sentence, and each puts an LLM in the verification loop:

- **CiteCheck** (arXiv:2605.27700): candidates from scholarly sources, then a structured LLM verifier; labels Exact / Minor / Major. Reports 88.7 macro-F1 on its own 982-citation physics benchmark with controlled corruptions. No public tool is linked from the paper page.
- **CiteAudit** (arXiv:2602.23452): a benchmark plus a multi-agent pipeline (metadata extraction, memory lookup, web retrieval, judgment). Code on GitHub; the abstract gives no figures.
- **Hallucination Detector on AtomGPT.org** (arXiv:2607.09774): LLM field extraction plus Semantic Scholar retrieval, scoring title, authors and venue; a web tool. Its abstract reports that it flags "the great majority" of the NeurIPS 2025 hallucinated citations, without numbers.

None of them has been run on the Zenodo set, HALLMARK or our blind papers, so no accuracy comparison is claimed. What differs by design is that Veracite needs no LLM or API key, keeps the document on the device, and adds evidence-based claim triage.
