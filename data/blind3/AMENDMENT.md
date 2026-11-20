# Pre-run source amendment

Selection is complete: 14 PDFs, 67 rejected selection records. The selection rule, selected files, version-pinned IDs and ground-truth source counts remain unchanged. No selected PDF has been parsed or verified; there is no `results.json` or `run.lock`.

Selection source was frozen at `497cb22379ea0c1f55a0e13dbc0f57c7d12e754e`. Before the first blind run, the outstanding spent-set regression exposed common date/venue parsing errors and a mistaken historical adjudication. The allowance waiter was stopped before inference or verification. The bounded correction pass uses only spent sets and pre-existing development benchmarks:

- Recognize the author-year separator in AAS references and split comma-separated journal/volume/page tails; a year inside a title must not override the year after the authors.
- Do not treat a standalone publication month/year as a venue.
- Recover a parsed title tail as a venue match only when the complete title and the actual matching venue are explicitly present outside URLs.
- Return the first exact token span before fuzzy search. This is an output-preserving optimization: an exact span has the maximum score and keeps the original tie rule.

No model, thresholds, abstention rules, selection criteria or new-paper-specific exceptions are changed. The selected papers are not used for development. After the existing benchmarks, development corpus and spent-set regressions pass, record a new audit freeze commit in the manifest alongside the preserved selection freeze. Only then restart the one-shot allowance waiter from that snapshot. Report its actual commit in results; preserve this amendment and the original selection identity.

This supersedes the original protocol's no-source-change interval only before any selected paper is parsed or any outcome is observed. It does not authorize tuning after the third run or replacing difficult papers. The original 497cb22 source remains available as an immutable worktree/commit.
