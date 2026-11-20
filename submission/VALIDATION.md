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
| Independent round 3 | Selection complete: 14 PDFs, 67 rejected records. No selected paper parsed or verified before the pre-run amendment; `data/blind3/AMENDMENT.md`. Awaiting free allowance and frozen run; no quality result yet. |

The dev corpus originally had 38 files, including one arXiv paper twice under different categories. Deduplicated counts above replace the earlier 1890/1896 headline. Missing-field/debris rates are health heuristics, not manually judged accuracy.

The earlier privacy script checked non-overlapping windows after dropping short words. The production audit now checks contiguous seven-word windows with one-word stride, reports how many it checked and fails on a detected leak or incomplete/empty audit. This is a bounded network-observation test, not a universal proof of privacy. The first DOCX run verified two references and left one unchecked while indexes were limited; references finished in 38 seconds, both claims in 364 seconds. On final `07f4f4a`, references took 41 seconds and claim tasks 193 seconds, with one source unavailable. These ran alongside other acceptance work and are not standalone speed benchmarks.

Historical independent evidence remains frozen sets 1 and 2: false alarms 13.7% and 11.6% of all extracted references, with 79.7% and 77.8% verified coverage. Set 1 was originally reported as 5 real / 86 false; visual re-review of the original PDF corrected one extraction-induced author flag to false (4 real / 87 false). The original run is unchanged; the evidence and overlay are in `data/blind/REVIEW_CORRECTIONS.md`. These sets informed fixes and cannot validate the current parser independently. The third run must retain failed extractions, report abstentions and include manual field/miss/flag review before judging the ≤2% target.

A 95/100 readiness claim is not supported while the independent audit and its manual reviews are unfinished. Production acceptance passed within the scopes above. No video has been recorded and no Devpost submission has been made.

The readiness assessment follows the [official rules' rubric](https://slayy-hacks.devpost.com/rules): innovation is supported by field-level checks plus local claim triage; implementation by shared benchmarked code and deployed browser inference; practical value by working inputs, corrections and exports; responsible AI by evidence, abstention and network observation; UX by the inspected desktop layout and completed workflows. The remaining decisive gaps are independent current false-alarm/coverage/field accuracy, API-limited coverage and cold full-audit latency. These prevent a defensible championship-readiness score of 95 rather than being silently assigned full points.

Production timings from that run: planted sample 4s, NeurIPS sample 37s, Attention sample 72s, Attention claim upgrade 687s. Live inputs took PDF 180s, DOCX 41s, BibTeX 40s, pasted text 40s, arXiv 192s. They include real network delays and ran alongside development/acceptance jobs; they are observations, not an isolated speed benchmark. The 3.4s local Attention measurement is a different, recorded-response condition and must not be used as live-paper latency. Limited indexes left some real-input references unchecked (6/50 PDF, 7/40 arXiv); a completed workflow does not imply full verification coverage.

## November 21 pre-run amendment

One bounded pass on spent/dev data fixes AAS author-year segmentation, comma-separated journal tails, date-only venues, and title-tail venue recovery with explicit raw-reference evidence. An exact-span fast path preserves fuzzy-search output in 24 regression cases; eight date/year assertions and three positive/negative venue assertions pass without network requests. Models, thresholds and abstention policy are unchanged. Zenodo, HALLMARK dev, the 37-paper corpus and both spent verification regressions passed; historical held-out benchmark tests were not rerun. Selection at 497cb22 is preserved; the manifest will record the separate audit commit before the third run.
