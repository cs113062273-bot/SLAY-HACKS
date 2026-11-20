# Production acceptance evidence

November 20, 2026. Site: https://cs113062273-bot.github.io/SLAY-HACKS/

Source/protocol freeze: `497cb22`. [Pages workflow](https://github.com/cs113062273-bot/SLAY-HACKS/actions/runs/44759629091): application TypeScript check, production build and deployment succeeded. HTTP 200 verified. At 1500×1000, the production landing page has no horizontal overflow and crossOriginIsolated is true; screenshot `shots/1-landing.png`.

Product correction `07f4f4a` isolates recorded sample responses from subsequent live audits and clears optional state on reset. [Its build and deployment](https://github.com/cs113062273-bot/SLAY-HACKS/actions/runs/44762286020) succeeded. The focused sample→same-reference live-input regression passed locally and on production: 40 sample references, followed by one live reference verified through three new Crossref/DataCite requests, with no replay label. Its first local attempt caught the stale replay label and failed; that reset bug was fixed. Production exited successfully with no stderr (`data/sample-isolation-production.json`). The reference core is unchanged from `497cb22`, which remains the third round's freeze. The first comprehensive production run began before this cache correction, so the five inputs have also passed on the final version without loading a sample snapshot.

| Check | Evidence / status |
|---|---|
| Zenodo reference benchmark | Current core F1 .971; `data/reg_zenodo_freeze.txt` |
| HALLMARK dev, 310 references | Current core F1 .986, FPR 0; `data/reg_hallmark_freeze.txt` |
| Parser development corpus | 37 unique papers, 1833/1839 (99.7%) count completeness, zero total extraction failures; `data/parser_dev/freeze-eval-unique.txt` |
| Spent blind parser regression | Set1 693/706, set2 477/479; capped counts, several approximate denominators; `data/*/parser-regression.json` |
| Current verification regression on spent sets | In progress; `data/blind/recheck-freeze.txt`, `data/blind2/recheck-freeze.txt` |
| Production samples, five input types, exports, claim upgrade | Passed (exit 0): samples 12/65/40 refs, inputs PDF 50 / DOCX 3 / BibTeX 3 / text 2 / arXiv 40; all 56 claim tasks finished; three nonempty exports, no site asset or page errors; `data/production-e2e.json` |
| Final five inputs without sample snapshots | Passed on `07f4f4a`, exit 0: PDF 50 / DOCX 3 / BibTeX 3 / text 2 / arXiv 40 refs; COI true, no site asset/page errors; `data/production-inputs-final.json` |
| Sample cache isolation in the same tab | Passed on production: 3 live index requests after a 40-ref sample; `data/sample-isolation-production.json` |
| Production privacy audit | Final `07f4f4a` passed: DOCX 3 refs, 2 claim tasks (1 supported, 1 no source), 5 contiguous seven-word windows; zero non-GET requests or observed leaks, exit 0; `data/production-privacy-final.json` |
| Independent round 3 | Selection in progress at frozen commit; `data/blind3/PROTOCOL.md` and `selection.log`. No quality result yet. |

The dev corpus originally had 38 files, including one arXiv paper twice under different categories. Deduplicated counts above replace the earlier 1890/1896 headline. Missing-field/debris rates are health heuristics, not manually judged accuracy.

The earlier privacy script checked non-overlapping windows after dropping short words. The production audit now checks contiguous seven-word windows with one-word stride, reports how many it checked and fails on a detected leak or incomplete/empty audit. This is a bounded network-observation test, not a universal proof of privacy. The first DOCX run verified two references and left one unchecked while indexes were limited; references finished in 38 seconds, both claims in 364 seconds. On final `07f4f4a`, references took 41 seconds and claim tasks 193 seconds, with one source unavailable. These ran alongside other acceptance work and are not standalone speed benchmarks.

Current independent evidence remains frozen sets 1 and 2: false alarms 13.5% and 11.6% of all extracted references, with 79.7% and 77.8% verified coverage. Those sets informed fixes and cannot validate the current parser independently. The third run must retain failed extractions, report abstentions and include manual field/miss/flag review before judging the ≤2% target.

A 95/100 readiness claim is not supported while the independent audit and spent-set verification regressions are unfinished. Production acceptance passed within the scopes above. No video has been recorded and no Devpost submission has been made.

The readiness assessment follows the [official rules' rubric](https://slayy-hacks.devpost.com/rules): innovation is supported by field-level checks plus local claim triage; implementation by shared benchmarked code and deployed browser inference; practical value by working inputs, corrections and exports; responsible AI by evidence, abstention and network observation; UX by the inspected desktop layout and completed workflows. The remaining decisive gaps are independent current false-alarm/coverage/field accuracy, API-limited coverage and cold full-audit latency. These prevent a defensible championship-readiness score of 95 rather than being silently assigned full points.

Production timings from that run: planted sample 4s, NeurIPS sample 37s, Attention sample 72s, Attention claim upgrade 687s. Live inputs took PDF 180s, DOCX 41s, BibTeX 40s, pasted text 40s, arXiv 192s. They include real network delays and ran alongside development/acceptance jobs; they are observations, not an isolated speed benchmark. The 3.4s local Attention measurement is a different, recorded-response condition and must not be used as live-paper latency. Limited indexes left some real-input references unchecked (6/50 PDF, 7/40 arXiv); a completed workflow does not imply full verification coverage.
