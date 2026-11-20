# Adjudication correction for frozen set 1

The frozen program output in `results.json` is unchanged. Its original manual count was 5 real errors, 86 false alarms and 1 uncertain among 92 flags.

Rechecking the apparent lost error at global review index 76 revealed a wrong manual label. The citing PDF's physical page 18 lists Pillow, Shlens, Chichilnisky and Simoncelli together; its DOI matches the [publisher's four-author record](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0062123). The old extracted string retained only Simoncelli with corrupted initials. The missing-author flag was therefore an extraction-induced false alarm, not an error in the actual reference.

Evidence: [version-pinned citing PDF](https://arxiv.org/pdf/2611.24767v1), page 18, visually rendered in `review-evidence/simoncelli-p18.png`. Machine-readable overlay: `review-corrections.json`.

Corrected adjudication: **4 labelled real errors, 87 false alarms, 1 uncertain**. The run still has 635 extracted references and 92 flags. Corrected false alarms / all references = **13.7%**; flag precision = **4/92 = 4.3%**. The old 13.5% / 5.4% figures describe the original adjudication, not the corrected one. The 0/42 miss sample is unchanged; it does not establish zero misses overall.

The first current-code recheck used the original labels and printed “4/5 real kept”. After this documented correction it retains **4/4 labelled real errors** and fixes **72/87** previously judged false alarms; 12 additional flags require separate review. Do not rerun the full dataset merely to recalculate this one label.

The subsequent bounded pre-audit amendment was validated once on both spent sets for its date/venue changes. Its separate `recheck-preblind.txt` retains 4/4 real errors, removes 74/87 old false alarms, and has 9 new flags requiring review. This is a development regression, not an independent quality estimate.
