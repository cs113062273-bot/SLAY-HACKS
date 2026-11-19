# SLAY HACKS 2026 submission checklist

Deadline: **Dec 7, 2026, 5:00 pm EST** (Dec 8, 06:00 Taiwan time). Judging Dec 8–14, winners Dec 16.
Source: slayy-hacks.devpost.com (rules and overview, checked 2026-11-18).

## Required by the rules

| Item | Status | Owner |
|---|---|---|
| Eligibility: every team member is a student above the age of majority | confirm | you |
| Project name and overview | drafted in `submission/DEVPOST.md` | done |
| Problem and solution | drafted | done |
| AI implementation (models, frameworks) | drafted, with model sizes and training data | done |
| **Working demo link** with access instructions | waiting for GitHub Pages deploy | you approve the push |
| Screenshots | `data/shots/` (landing, report, claim view, quick mode) | done; pick 3–5 |
| **Source repository** with docs and setup steps | README.md; repo `cs113062273-bot/SLAY-HACKS` | you confirm account and visibility |
| Disclose significant limitations and external dependencies | README "Responsible use" and DEVPOST "Limitations" | done |
| Description matches what the product actually does (misrepresentation = disqualification) | every claim is tied to a reproducible script | done |
| Third-party licences respected | models: MIT (DeBERTa-v3 NLI base), MIT (e5-small-v2); datasets cited | done |

## Recommended

| Item | Status |
|---|---|
| 2–4 minute demo video | script in `submission/DEMO_SCRIPT.md`; **recording needs your approval** (SKILL.md rule) |
| Built-with tags | listed in DEVPOST.md |
| Thumbnail / cover image | use `data/shots/landing-modes.png` or a crop of the report |

## Before pressing Submit

1. Open the live URL in a private window on a second machine: run all three samples, upload one PDF and one .bib.
2. Run `VERACITE_URL=<live url> npx tsx scripts/privacy-audit.ts` against the live site: no POST requests, no document text in any request.
3. Check that the Devpost text, README and landing page show the same numbers.
4. Make the repository public (or confirm judges can access it).
5. Submit on Devpost **at least a day early**. Devpost lets you edit until the deadline.

## How each judging criterion is met

| Criterion (weight) | Where the evidence is |
|---|---|
| Innovation & Creativity (30) / Innovation & Originality (25) | Field-level cross-verification + claim support with evidence in one free in-browser tool; comparison in `COMPARISON.md` |
| Technical Execution & Complexity (30) / Technical Implementation (25) | Layout-aware PDF parsing, 7 index integrations with failure handling, a fine-tuned 4-bit DeBERTa running in WebAssembly, three public benchmarks |
| Design & UX (20) / UX & Presentation (15) | Quick vs full mode, results stream in, per-field diff, one-click corrected BibTeX, keyboard navigation, dark mode |
| Presentation & Impact (20) / Real-World Impact (20) | Fabricated-citation statistics from *The Lancet* and NeurIPS 2025; deployable static site, no account |
| AI Integration & Responsible Use (15) | Calibrated labels (no verdict where the model is unreliable), evidence shown for every claim, private by design, limitations disclosed |
