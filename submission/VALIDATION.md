# Production acceptance evidence

November 20, 2026. Site: https://cs113062273-bot.github.io/SLAY-HACKS/

Source/protocol freeze: `497cb22`. [Pages workflow](https://github.com/cs113062273-bot/SLAY-HACKS/actions/runs/44759629091): application TypeScript check, production build and deployment succeeded. HTTP 200 verified. At 1500×1000, the production landing page has no horizontal overflow and crossOriginIsolated is true; screenshot `shots/1-landing.png`.

Product correction `07f4f4a` isolates recorded sample responses from subsequent live audits and clears optional state on reset. [Its build and deployment](https://github.com/cs113062273-bot/SLAY-HACKS/actions/runs/44762286020) succeeded. The focused sample→same-reference live-input regression passed locally and on production: 40 sample references, followed by one live reference verified through three new Crossref/DataCite requests, with no replay label. Its first local attempt caught the stale replay label and failed; that reset bug was fixed. Production exited successfully with no stderr (`data/sample-isolation-production.json`). The reference core is unchanged from `497cb22`, which remains the third round's freeze. The first comprehensive production run began before this cache correction, so the five inputs are being repeated on the final version without loading a sample snapshot.

| Check | Evidence / status |
|---|---|
| Zenodo reference benchmark | Current core F1 .971; `data/reg_zenodo_freeze.txt` |
| HALLMARK dev, 310 references | Current core F1 .986, FPR 0; `data/reg_hallmark_freeze.txt` |
| Parser development corpus | 37 unique papers, 1833/1839 (99.7%) count completeness, zero total extraction failures; `data/parser_dev/freeze-eval-unique.txt` |
| Spent blind parser regression | Set1 693/706, set2 477/479; capped counts, several approximate denominators; `data/*/parser-regression.json` |
| Current verification regression on spent sets | In progress; `data/blind/recheck-freeze.txt`, `data/blind2/recheck-freeze.txt` |
| Production samples, five input types, exports, claim upgrade | In progress; `data/production-e2e.json` |
| Final five inputs without sample snapshots | In progress on `07f4f4a`; `data/production-inputs-final.json` |
| Sample cache isolation in the same tab | Passed on production: 3 live index requests after a 40-ref sample; `data/sample-isolation-production.json` |
| Production privacy audit | Passed on fresh-profile DOCX: 3 references, 2 model-labelled claims, 5 contiguous seven-word windows, zero non-GET requests or observed leaks; `data/production-privacy.json` |
| Independent round 3 | Selection in progress at frozen commit; `data/blind3/PROTOCOL.md` and `selection.log`. No quality result yet. |

The dev corpus originally had 38 files, including one arXiv paper twice under different categories. Deduplicated counts above replace the earlier 1890/1896 headline. Missing-field/debris rates are health heuristics, not manually judged accuracy.

The earlier privacy script checked non-overlapping windows after dropping short words. The production audit now checks contiguous seven-word windows with one-word stride, reports how many it checked and fails on a detected leak or incomplete/empty audit. This is a bounded network-observation test, not a universal proof of privacy. The DOCX run verified two references and left one unchecked while indexes were limited; references finished in 38 seconds, both claims in 364 seconds. It ran alongside other acceptance work and is not a standalone speed benchmark.

Current independent evidence remains frozen sets 1 and 2: false alarms 13.5% and 11.6% of all extracted references, with 79.7% and 77.8% verified coverage. Those sets informed fixes and cannot validate the current parser independently. The third run must retain failed extractions, report abstentions and include manual field/miss/flag review before judging the ≤2% target.

A 95/100 readiness claim is not supported while the independent audit and production acceptance are unfinished. No video has been recorded and no Devpost submission has been made.
