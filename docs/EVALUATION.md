# Veracite evaluation on real papers

The public benchmarks in the README supply clean reference strings and were used, at least in part, during development. This page records what happens on real PDFs that nobody had looked at: three blind rounds, each chosen by a rule fixed in code before any paper was opened, audited once with the code frozen, and every flag judged by hand. Frozen outputs are never edited; later fixes are measured separately and labelled as development results.

| | Blind 1 | Blind 2 | **Blind 3** |
|---|---|---|---|
| Code frozen at | `15daf9d` | `61f1844` | `3e47ac9` |
| Papers / fields | 14 / 14 | 14 / 12 more | 14 / 12 more + 2 PLOS ONE |
| PDFs that yielded no reference list | 4 of 18 (replaced) | 7 of 21 (replaced) | **0 of 14** |
| Main-bibliography completeness | n/a | n/a | **964 / 969 (99.5%)** |
| References audited | 635 | 465 | 964 |
| Verified coverage | 79.7% | 77.8% | **81.1%** |
| Real errors / uncertain / false alarms | 4 / 1 / 87 | 7 / 2 / 54 | 1 / 2 / 98 |
| False alarms ÷ all references | 13.7% | 11.6% | **10.2%** (median paper 3.7%) |
| Misses in a random sample of verified references | 0 / 42 | 0 / 41 | 0 / 42 |

The trend is real but modest, and the 2% false-alarm target was **not** met. Extraction is no longer the problem (no failed PDF, 99.5% of entries found, segmentation 69/70 correct in the field sample). The remaining false alarms concentrate in two physics papers whose citation conventions the verifier did not know: a particle-physics paper (52 false alarms in 150 references: "JHEP" not recognised as the Journal of High Energy Physics, arXiv titles written in LaTeX, collaboration names before the author list) and an astrophysics paper (18 in 164: ApJ Letters filed under ApJ, INSPIRE-style title variants). The other twelve papers together have 28 false alarms in 650 references (4.3%).

## Blind test 3 (frozen, November 21, 2026)

Protocol: `data/blind3/PROTOCOL.md`, pre-run amendment `data/blind3/AMENDMENT.md`. Selection was fixed at `497cb22` (`app/scripts/pick-blind3.py`: the newest paper in each of 12 arXiv categories never used before that has a downloadable PDF and a ≥10-entry `.bbl`, plus the two newest PLOS ONE research articles counted from JATS; 67 rejected candidates recorded). The audit ran once at `3e47ac9` from the PDFs with an empty cache, the browser's settings (six reference workers, 40 s budget per reference), papers one after another, no API keys. It ran 50 minutes, under heavy throttling: Crossref answered HTTP 429 1,992 times, Semantic Scholar 561 and OpenAlex 349 (its free daily allowance ran out mid-run).

Review: every flag was checked against the PDF (poppler text, independent of the pdf.js extractor) and the publisher or identifier record, with a source URL and explanation for each (`data/blind3/reviews.json`, merged into `results.json`). Five references per paper, sampled independently of the verdict, were checked field by field against the PDF; three verified references per paper were checked for missed errors. Pending items were confirmed online after the run (Crossref, doi.org handles, arXiv, CVF open access).

| Paper | Refs found / in source | Verified | Flags | False alarms | Seconds |
|---|---|---|---|---|---|
| cs.DC 2611.26526 | 40 / 40 | 85% | 2 | 1 (+1 uncertain) | 77 |
| cs.SI 2611.23175 | 48 / 48 | 98% | 1 | 1 | 105 |
| math.NA 2611.25245 | 85 / 85 | 93% | 3 | 3 | 308 |
| math.ST 2611.25163 | 52 / 52 | 96% | 2 | 2 | 127 |
| physics.plasm-ph 2611.24523 | 58 / 58 | 64% | 2 | 2 | 280 |
| physics.ins-det 2611.24776 | 72 / 72 | 89% | 4 | 4 | 211 |
| cond-mat.mes-hall 2611.26616 | 75 / 78 | 93% | 3 | 3 | 212 |
| astro-ph.HE 2611.26547 | 164 / 164 | 87% | 18 | 18 | 510 |
| hep-ex 2611.26449 | 150 / 151 | 45% | 53 | 52 (+1 uncertain) | 541 |
| q-bio.BM 2611.19885 | 62 / 63 | 92% | 2 | 2 | 208 |
| cs.NE 2611.24848 | 22 / 22 | 95% | 0 | 0 | 65 |
| nlin.CD 2611.23434 | 66 / 66 | 92% | 2 | 2 | 208 |
| PLOS ONE 0363220 | 45 / 45 | 76% | 4 | 3 (+1 real) | 118 |
| PLOS ONE 0360499 | 25 / 25 | 76% | 5 | 5 | 64 |
| **Total** | **964 / 969** | **81.1%** | **101** | **98** | median 208 |

The real error is an incomplete author list (6 of 8 authors, no "et al.", and no volume) in a PLOS ONE paper. The two uncertain flags are a DOI that is not registered anywhere (Balsam, PyHPC 2019; the paper exists on arXiv) and a 1991 title cited in its INSPIRE wording rather than the published one. Flag precision is therefore 1/101; with only one real error among 964 references this set says little about recall beyond the miss sample.

Field accuracy on the 70 independently sampled references (PDF as truth, N/A when the PDF prints no such field):

| Field | Correct | Wrong | N/A | Accuracy |
|---|---|---|---|---|
| Segmentation | 69 | 1 | 0 | 98.6% |
| Title | 56 | 9 | 5 | 86.2% |
| Authors | 62 | 8 | 0 | 88.6% |
| Year | 70 | 0 | 0 | 100% |
| Venue | 61 | 6 | 3 | 91.0% |
| Identifiers | 19 | 9 | 42 | 67.9% |

Identifier errors were mostly DOIs that the PDF text layer prints with spaces ("10 . 1145 / 2807591 . 280 7623") and pre-2007 arXiv identifiers ("gr-qc/9806024") that the parser did not know.

False-alarm causes (98):

| Cause | False alarms |
|---|---|
| Venue abbreviation or article number not recognised (JHEP, JOSA A, ApJ Letters, "Science Advances 4, eaat0346", NLM abbreviation, a PMID read as the venue) | 25 |
| Index title notation differs from the citation (LaTeX math in arXiv titles, HTML entities, INSPIRE/arXiv title variants, an OCR error in a record) | 22 |
| PDF text-layer artefacts (scattered subscripts, spaced DOIs and URLs, interleaved columns, a glued label) | 13 |
| A different record with a similar title was chosen | 12 |
| The work exists but its cited version is not indexed or was not reached (CVPR, PMLR, OpenReview, Russian originals, datasets, software, rate limits) | 12 |
| Author list parsing (collaboration names, title words read as authors) | 11 |
| Edition or deposit year | 2 |
| Incomplete index record | 1 |

Artifacts: `data/blind3/results.json` (every reference, verdict, matched record and judgement), `field_sample.json`, `miss_sample.txt`, `summary.json`, `reviews.json`, `run-final2.log`. Review helpers: `app/scripts/review-blind3.py`, `merge-blind3-reviews.py`, `summarize-blind3.py`.

### After blind test 3 (development, not independent)

General rules were added for the dominant causes above: JHEP and ApJ as known journals, venue tokens without volume numbers, full-word initials, LaTeX commands and sub/superscripts in titles, Springer's LaTeX preamble in Crossref titles, collaboration names before author lists, Western and Vancouver names glued into one author, pre-2007 arXiv identifiers, DOIs and URLs spaced by the text layer, explicit editions and page-footer date stamps (`7356413`). A second bounded pass (`ed205f7`) added six more: laboratory report numbers ("CERN-LHCC-2012-007") and archived GitHub releases ("owner/repo: 0.1") are typed as reports and software instead of being called fabricated; "Submitted to …" is not compared as a published venue; math symbols scattered by the text layer no longer count as title changes; a venue is also read from the last comma segment when title math runs into it; and NLM place qualifiers ("Infect Dis Lond Engl") are ignored. Blind set 3 was used to find all of these, so re-checking it measures development progress, not independent quality.

**Measuring without the rate limits.** The first live regressions of `7356413` were unusable: OpenAlex's free daily allowance was spent and Semantic Scholar answered HTTP 429, so the Zenodo run fell to F1 .780, with all ten misses reported as *unchecked*. The regressions were therefore re-run offline (`VERACITE_REPLAY`): every lookup is answered from responses recorded in earlier runs, and a lookup that nobody recorded counts as a failed source for that reference and is tracked. A flag that disappears only because a lookup went unanswered is not counted as fixed.

| | Before the fixes | `7356413`, replay | Final `ad06636` |
|---|---|---|---|
| Zenodo, 104 references | F1 .971 | F1 .971 (same two false positives) | F1 .971 |
| HALLMARK dev, 310 entries | F1 .986, FPR 0 | F1 .986, FPR 0 | F1 .986, FPR 0 |
| Set 1: judged false alarms now confirmed by a matched record | n/a | 69 / 87 | 68 / 87 |
| Set 2: same | n/a | 36 / 54 | 36 / 54 |
| Set 3: same | n/a | 47 / 98 | **62 / 98** |
| Judged real errors still flagged (sets 1 / 2 / 3) | | 4/4 · 7/7 · 1/1 | 4/4 · 7/7 · 1/1 |
| Set 3 flags (frozen run: 101) | | 57 | **45** |

Replay alone flatters the new code: when it asks a question that no earlier run recorded (for example about a pre-2007 arXiv identifier), the reference becomes *unchecked* and drops out of both the fixes and the flags. On set 3 that happened to 26 judged false alarms. Those lookups were therefore made live once (`recheck-livefill-rules.txt`, with OpenAlex's allowance spent) and the final code was replayed over the recorded answers (`recheck-filled-ad06636.txt`); the final-column set-3 numbers come from that run, and only 5 judged false alarms remain undetermined. Of the 45 flags, 1 is the real error, 2 are the uncertain ones, 31 are judged false alarms and 11 are new. On inspection all 11 new flags are false alarms too (mostly JHEP papers whose journal version the indexes did not return, plus a 2026 particle-data review matched to an earlier edition and a 1957 Physical Review paper not found). False alarms are therefore about 42 / 964 = **4.4%** of references, against 10.2% in the frozen run. This is the set the rules were written from, so it is an optimistic development number; the independent estimate remains the frozen 10.2%. Replays are also not perfectly repeatable: with four references verified in parallel, the per-reference time budget and source order can change which record wins (set 1 flag #3 is *verified* in isolation three times out of three but was flagged in one full run).

The final code adds one more fix found by the production test rather than by a blind set: when Semantic Scholar and OpenAlex both fail, a reference with a DOI is now *unchecked* instead of *not found* (`3e6fa6e`), and GitHub or Hugging Face answering no longer counts as an index having answered for a paper. Numbered institutional reports ("GMD Report 148") are typed as reports (`ad06636`).

### Systemic pass and controlled error injection (November 22, development)

The remaining false alarms on the spent sets were grouped by cause rather than fixed one format at a time. Most came from five systemic gaps, now handled by general rules:

- **Evidence is anchored on the reference text, not on the parse.** A title difference is now measured against the stretch of the raw reference that the record's title aligns to. When every word of the record's title is in the reference and the leftover cited words belong to its authors or venue, the parser misplaced a boundary; a substituted word is never excused, because the record's word is then missing from the text. Venue strings that cannot name a journal (URL fragments, pages and months, math, the tail of the record's own title) are no longer compared.
- **Notation and naming variants.** Acronyms spelled out on the other side ("QPOs of SGRs"), German transliteration, Roman vs Arabic part numbers, function-word-only differences, and symbol tokens in math titles (Greek letters spelled out, "B → K" written as "Bpmto K", tags such as "[C2]") are cosmetic. Index records with LaTeX are converted to symbols instead of glued words.
- **Version-aware years and venues.** A journal cited a few years after its only indexed preprint (including Semantic Scholar dating JMLR papers by their arXiv year), another edition of a book with different co-authors, Russian journals indexed through their English translations, and an index author list with a trailing editor are minor, not errors. One omitted author placed between cited authors is still an error.
- **Record choice.** The record reached through the cited DOI or arXiv ID is preferred; a record listing only a collaboration cannot beat one that names the cited people; issue furniture ("2009 Index …", "Information for authors") is never a match; family and given names swapped by the index match.
- **A new source for physics.** INSPIRE-HEP (free, CORS-enabled) is queried for physics and astronomy references: by arXiv ID it supplies the journal version of a preprint, and by title it finds papers the general indexes miss. Grey literature with an institutional author or publisher (ministries, statistics bureaus, "SciPy developers") is typed as a report and reported as not indexed rather than not found.

The pass also tightened detection where the stress test below showed gaps: a cited name in a long author list that shares nothing with the record's author in that position is a substitution (it was treated as a typo); citing 1 to 3 of more than ten authors without "et al." is an incomplete list; Crossref's `created` date (when a DOI was deposited, often years after publication) no longer counts as a publication year; and a quoted title that has nothing in common with the record it otherwise matches is reported.

**Controlled error injection.** Natural papers contain very few real errors (12 across the three blind sets), which says little about recall. `app/scripts/stress-build.ts` therefore builds a stress set from real PDF reference strings: 264 references from 41 spent-set papers that the system verified cleanly by offline replay, each turned into an unmodified control, two benign rewrites that must still verify (identifiers removed, authors after the first replaced by "et al.", title lower-cased) and three injected errors chosen in rotation: DOI or arXiv ID digits changed, another work's DOI, first or a later author replaced, all authors after the first removed, year shifted by 2–4, one title word replaced, venue replaced, or the title replaced by an invented one with identifiers removed. An injected string is kept only if re-parsing it shows the intended change. 1,499 items: 707 correct, 792 errors. Both code versions were scored by offline replay over the same recorded responses (`data/stress/results-base-replay.*`, `results-systemic-final.*`; `app/scripts/stress-compare.py` lists every changed outcome).

| | Before (`ad06636`) | After this pass |
|---|---|---|
| Precision | .991 | **.994** |
| Recall | .881 | **.910** |
| F1 | .933 | **.951** |
| False alarms on correct references | 6 / 707 | 4 / 707 (0 of 264 unmodified controls) |
| Flags that name the injected field | 99.6% | 99.7% |

| Injected error (n) | Before | After |
|---|---|---|
| DOI / arXiv digits (95), another DOI (64) | 100% · 100% | 100% · 100% |
| First author replaced (95) | 98.9% | 98.9% |
| Later author replaced (95) | 74.7% | **91.6%** |
| Authors dropped, no "et al." (60) | 95.0% | **100%** |
| Year shifted (96) | 87.5% | 88.5% |
| Title word replaced (96) | 95.8% | 95.8% |
| Venue replaced (96) | 87.5% | 89.6% |
| Invented title (95) | 60.0% | 61.1% |

Two items moved the wrong way: a shifted year now lies within one year of the INSPIRE preprint date, and a substituted first author of a collaboration paper is not caught. The remaining misses are design limits rather than bugs: years within the preprint tolerance (±2 when the reference cites arXiv), a renamed arXiv entry by the same authors, and venues that the record does not carry. **Invented titles depend on index availability**: in these bulk runs OpenAlex's free allowance was spent and Semantic Scholar throttled. Of the 59 invented titles for which Semantic Scholar or OpenAlex answered, 57 were flagged; all 36 for which neither answered were reported as *unchecked*, never as verified. In the browser a second, slower pass now re-checks references left unchecked by rate limits before the report is final.

This is development evidence on spent papers, with errors injected by our own generator: it measures sensitivity to known error types, not the false-alarm rate on new papers.

**Spent blind sets, re-checked (development regression, not a new test).** The 2,276 references of the three spent blind sets were re-checked with the code before (`806cbbe`) and after this pass, by offline replay over the same recorded responses (`data/blind*/recheck-cov-{base,new}.txt`; a live pass first recorded the lookups the new code makes, `recheck-livefill2.txt`). Removing a false alarm by turning it into *unchecked* or *unverifiable* does not count as a fix, so the full verdict distribution is reported:

| | Before | After |
|---|---|---|
| Flags | 116 | 49 |
| Verified or verified with minor differences | 1,999 | **2,056** |
| Unverifiable (not indexed) | 133 | 143 |
| Unchecked (an index did not answer) | 28 | 28 |
| Judged real errors still flagged | 12 / 12 | 12 / 12 |
| Original judged false alarms no longer flagged (set 1 / 2 / 3) | 68 / 36 / 62 | 79 / 43 / 82 of 87 / 54 / 98 |
| Development false-alarm rate (set 1 / 2 / 3) | — | ≈1.0% / 1.5% / 1.45% |

Of the 67 fewer flags, 57 references now verify and 10 became unverifiable; all 10 had been judged false alarms (a company blog, a regulation, a census report, a committee web page, and physics references whose lookups were not recorded in replay). The new flags include two real errors that the earlier code missed: two arXiv IDs in a hep-ph paper that point to other papers (hep-ph/0306007 and hep-ph/0411341, confirmed in INSPIRE and DataCite). These rates were measured on papers the rules were developed against, so they are an upper bound on what the rules can do, not an independent estimate; the independent figure remains the frozen blind set 3 (10.2%) until a new frozen set is run.

## Earlier rounds

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

Two real papers (Lewis et al. 2020 on retrieval-augmented generation, and the GDPR) were labelled *fabricated* while an index was down. Crossref answered HTTP 429 963 times and Semantic Scholar 412 times during the run, because six papers ran at once; a single user checking one paper causes far fewer. Every flag, with the record it was compared with and our judgement, is in `data/blind/results.json`; the miss sample is `data/blind/miss_sample.txt`. Preserve that frozen output. Current spent-set regression uses `cd app && npx tsx scripts/recheck-blind.ts`; it is development evidence, not a new independent test.

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

The parser development manifest contains 38 PDF files representing **37 distinct papers** (one cross-listed arXiv paper appeared twice). Before deduplication, count completeness was 1890/1896 (99.7%). Deduplicated count completeness is **1833/1839 (99.7%)**, with no zero-reference PDFs. Field-health rates are no author 0.9%, no year 1.1%, debris author 3.3%; the latest amended-core output is in `data/parser_dev/preblind-eval.txt`; these are development measurements and missing-field/debris heuristics, not independently judged field accuracy. Some APS references omit titles in the source, so “no title” alone is not an error.

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

