# Blind set 4 amendment (selection only)

Recorded on November 22 before any set-4 paper was parsed or verified; no set-4 result exists.

The first selection pass (freeze `5155430`) picked 13 of 14 papers. q-bio.CB's recent listing held only four papers: three without a .bbl in their source and one cross-listed from another category. One hourly `--resume` found nothing new. Waiting for the category to fill would delay the run indefinitely, so q-bio.CB is replaced by the first of q-bio.MN, q-bio.TO, q-bio.SC (in that order, none used before) that yields an eligible paper under exactly the same rule (`app/scripts/pick-blind4-fallback.py`). The 13 existing picks, the audit freeze, the run settings and the review rules are unchanged. The replacement is marked `replaces: q-bio.CB` in the manifest and the report will disclose it.
