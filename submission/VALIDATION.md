# Production acceptance evidence

November 20, 2026. Site: https://cs113062273-bot.github.io/SLAY-HACKS/

Source/protocol freeze: `497cb22`. [Pages workflow](https://github.com/cs113062273-bot/SLAY-HACKS/actions/runs/44759629091): application TypeScript check, production build and deployment succeeded. HTTP 200 verified. At 1500×1000, the production landing page has no horizontal overflow and crossOriginIsolated is true; screenshot `shots/1-landing.png`.

Product correction `07f4f4a` isolates recorded sample responses from subsequent live audits and clears optional state on reset. [Its build and deployment](https://github.com/cs113062273-bot/SLAY-HACKS/actions/runs/44762286020) succeeded. The focused sample→same-reference live-input regression passed locally and on production: 40 sample references, followed by one live reference verified through three new Crossref/DataCite requests, with no replay label. Its first local attempt caught the stale replay label and failed; that reset bug was fixed. Production exited successfully with no stderr (`data/sample-isolation-production.json`). The reference core is unchanged from `497cb22`, which remains the selection freeze; the pre-run amendment below records the separate audit freeze. The first comprehensive production run began before this cache correction, so the five inputs have also passed on the final version without loading a sample snapshot.

| Check | Evidence / status |
|---|---|
| Zenodo reference benchmark | Amended core F1 .971; `data/reg_zenodo_preblind.txt` |
| HALLMARK dev, 310 references | Amended core F1 .986, FPR 0; `data/reg_hallmark_preblind.txt` |
| Parser development corpus | 37 unique papers, 1833/1839 (99.7%) count completeness, zero total extraction failures; `data/parser_dev/preblind-eval.txt` |
| Spent blind parser regression | Set1 693/706, set2 477/479; capped counts, several approximate denominators; `data/*/parser-regression.json` |
| Current verification regression on spent sets | Completed: set1 729 refs / 27 flags, 74/87 old false alarms removed, 4/4 old real retained; set2 583 refs / 34 flags, 42/54 old false removed, 7/7 old real retained. Nine and thirteen new flags remain unjudged. `data/*/recheck-preblind.txt`; development regression, not current precision |
| Production samples, five input types, exports, claim upgrade | Passed (exit 0): samples 12/65/40 refs, inputs PDF 50 / DOCX 3 / BibTeX 3 / text 2 / arXiv 40; all 56 claim tasks finished; three nonempty exports, no site asset or page errors; `data/production-e2e.json` |
| Final five inputs without sample snapshots | Passed on `07f4f4a`, exit 0: PDF 50 / DOCX 3 / BibTeX 3 / text 2 / arXiv 40 refs; COI true, no site asset/page errors; `data/production-inputs-final.json` |
| Sample cache isolation in the same tab | Passed on production: 3 live index requests after a 40-ref sample; `data/sample-isolation-production.json` |
| Production privacy audit | Final `07f4f4a` passed: DOCX 3 refs, 2 claim tasks (1 supported, 1 no source), 5 contiguous seven-word windows; zero non-GET requests or observed leaks, exit 0; `data/production-privacy-final.json` |
| Independent round 3 | Ran once at freeze `3e47ac9` (empty cache, browser settings, 50 min). 14/14 PDFs extracted; 964/969 entries (99.5%), no excess entries; 81.1% verified; flags 101 = 1 real, 2 uncertain, 98 false (10.2% of references; median paper 3.7%); 0/42 sampled misses; field accuracy on 70 sampled references: segmentation 98.6%, title 86.2%, authors 88.6%, year 100%, venue 91.0%, identifiers 67.9%; median 208 s per paper. Every flag reviewed with a source URL. `data/blind3/summary.json`, `reviews.json`, `docs/EVALUATION.md`. ≤2% false-alarm target **not met**. |

The dev corpus originally had 38 files, including one arXiv paper twice under different categories. Deduplicated counts above replace the earlier 1890/1896 headline. Missing-field/debris rates are health heuristics, not manually judged accuracy.

The earlier privacy script checked non-overlapping windows after dropping short words. The production audit now checks contiguous seven-word windows with one-word stride, reports how many it checked and fails on a detected leak or incomplete/empty audit. This is a bounded network-observation test, not a universal proof of privacy. The first DOCX run verified two references and left one unchecked while indexes were limited; references finished in 38 seconds, both claims in 364 seconds. On final `07f4f4a`, references took 41 seconds and claim tasks 193 seconds, with one source unavailable. These ran alongside other acceptance work and are not standalone speed benchmarks.

Historical independent evidence remains frozen sets 1 and 2: false alarms 13.7% and 11.6% of all extracted references, with 79.7% and 77.8% verified coverage. Set 1 was originally reported as 5 real / 86 false; visual re-review of the original PDF corrected one extraction-induced author flag to false (4 real / 87 false). The original run is unchanged; the evidence and overlay are in `data/blind/REVIEW_CORRECTIONS.md`. These sets informed fixes and cannot validate the current parser independently. The third run must retain failed extractions, report abstentions and include manual field/miss/flag review before judging the ≤2% target.

A 95/100 readiness claim is not supported while the independent audit and its manual reviews are unfinished. Production acceptance passed within the scopes above. No video has been recorded and no Devpost submission has been made.

The readiness assessment follows the [official rules' rubric](https://slayy-hacks.devpost.com/rules): innovation is supported by field-level checks plus local claim triage; implementation by shared benchmarked code and deployed browser inference; practical value by working inputs, corrections and exports; responsible AI by evidence, abstention and network observation; UX by the inspected desktop layout and completed workflows. The remaining decisive gaps are independent current false-alarm/coverage/field accuracy, API-limited coverage and cold full-audit latency. These prevent a defensible championship-readiness score of 95 rather than being silently assigned full points.

Production timings from that run: planted sample 4s, NeurIPS sample 37s, Attention sample 72s, Attention claim upgrade 687s. Live inputs took PDF 180s, DOCX 41s, BibTeX 40s, pasted text 40s, arXiv 192s. They include real network delays and ran alongside development/acceptance jobs; they are observations, not an isolated speed benchmark. The 3.4s local Attention measurement is a different, recorded-response condition and must not be used as live-paper latency. Limited indexes left some real-input references unchecked (6/50 PDF, 7/40 arXiv); a completed workflow does not imply full verification coverage.

## November 21 pre-run amendment

One bounded pass on spent/dev data fixes AAS author-year segmentation, comma-separated journal tails, date-only venues, and title-tail venue recovery with explicit raw-reference evidence. An exact-span fast path preserves fuzzy-search output in 24 regression cases; eight date/year assertions and three positive/negative venue assertions pass without network requests. Models, thresholds and abstention policy are unchanged. Zenodo, HALLMARK dev, the 37-paper corpus and both spent verification regressions passed; historical held-out benchmark tests were not rerun. Selection at 497cb22 is preserved; the manifest records separate audit commit `3e47ac9dedfaa3d90e981f16437e29928b99c8d7` before the third run. The final application typecheck/build passed (`data/build-preblind.txt`). A clean detached snapshot waits for the free allowance (Nov21 00:46 Taipei: HTTP429, remaining USD0, reset26027 seconds, about08:00); no third outcome exists yet.

## Amended production acceptance (November 21)

[Build and deployment](https://github.com/cs113062273-bot/SLAY-HACKS/actions/runs/44776807750) succeeded for main 9b345e7, whose application source is the audit freeze 3e47ac9. The served HTML referenced expected bundle index-BwFacMSf.js before the fresh-profile run. `data/production-inputs-amended.json` passed (exit0, empty stderr): crossOriginIsolated true, no site HTTP errors or page errors, all five live inputs finished without loading recorded samples.

| Input | Extracted refs | Verified + minor | Flags | Unchecked | Seconds |
|---|---:|---:|---:|---:|---:|
| PDF (ResNet development control) | 50 | 46 | 3 | 1 | 157 |
| DOCX fixture | 3 | 2 | 0 | 1 | 39 |
| BibTeX fixture with planted errors | 3 | 1 | 2 | 0 | 40 |
| Pasted text fixture | 2 | 1 | 0 | 1 | 41 |
| arXiv (Attention development control) | 40 | 38 | 0 | 2 | 121 |

These are observed live timings and functional completion, not a quality benchmark. The three PDF flags have not been adjudicated in this smoke test; prior runs' flags/coverage differ with index responses. This test does not establish their precision. The model and sample-cache routing were unchanged by the bounded amendment; full claim/export/isolation/privacy acceptance remains explicitly attributed to 07f4f4a above rather than relabelled as a new test.

## Post-blind-3 fixes and production acceptance (November 22)

Source `ed205f7` (two bounded passes after the third blind set: `7356413` and `ed205f7`). `npm run build` passed; [build and deployment](https://github.com/cs113062273-bot/SLAY-HACKS/actions/runs/44931030568) succeeded and the served bundle `index-CtHDlSAf.js` matched the local build.

**Regression method.** Live regressions of `7356413` ran while OpenAlex's free allowance was spent and Semantic Scholar returned HTTP 429: Zenodo fell to F1 .780, and all ten misses were *unchecked* (`data/reg_zenodo_postblind3.txt`). The benchmarks and spent sets were therefore re-run with `VERACITE_REPLAY`, which answers every lookup from responses recorded in earlier runs, makes no network request, and counts an unrecorded lookup as a failed source for that reference. A judged false alarm counts as fixed only when the reference now matches a record (*verified* or *minor*).

| Check | `7356413` | `ed205f7` | Output |
|---|---|---|---|
| Zenodo, 104 references | F1 .971 (unchanged) | F1 .971 | `data/reg_zenodo_replay*.txt` |
| HALLMARK dev, 310 | DR .971, FPR 0, F1 .986 (unchanged) | same | `data/reg_hallmark_replay*.txt` |
| Spent set 1 (729 refs) | 69/87 judged false alarms matched, 4/4 real kept, 32 flags | same | `data/blind/recheck-replay*.txt` |
| Spent set 2 (583 refs) | 36/54 matched, 7/7 real kept, 39 flags | same | `data/blind2/recheck-replay*.txt` |
| Spent set 3 (964 refs) | 47/98 matched, 1/1 real kept, 57 flags | 55/98 matched, 1/1 real kept, **43 flags** (frozen run 101) | `data/blind3/recheck-replay*.txt` |

The six `ed205f7` rules were also checked for collateral effects on all 6,096 references in the 119 local PDFs: the new report and software types matched exactly six references, all correct (five CERN/LHCb reports, one archived GitHub release). These are development results on data used to design the rules, not independent precision.

**Production E2E on `ed205f7`** (`data/production-live-e2e-ed205f7.txt`, exit 0, empty stderr): crossOriginIsolated true, no HTTP 4xx or page errors. Samples: planted 12 refs (5 verified, 1 wrong ID, 2 wrong details, 3 fabricated, 1 retracted), NeurIPS 65, Attention 40/40 verified or minor; three non-empty exports; claim upgrade finished all 56 tasks (15 supported, 1 needs review, 20 inconclusive, 16 mentions, 4 without source text). Live inputs: PDF 50 refs (44 verified/minor, 2 flags, 1 not indexed, 3 unchecked) 170 s; DOCX 3 refs 33 s; BibTeX 3 (verified / wrong ID / fabricated) 40 s; pasted text 2 21 s; arXiv 40 (32 verified/minor, 8 unchecked) 104 s. The run overlapped a live regression from the same machine while OpenAlex's allowance was spent, which explains the unchecked references; they are functional results, not coverage or speed benchmarks.
