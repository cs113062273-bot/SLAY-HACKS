# SLAY HACKS 2026 submission checklist

Deadline: **Dec 7, 2026, 5:00 pm EST** (Dec 8, 06:00 Taiwan time). Judging Dec 8–14, winners Dec 16.
Source: slayy-hacks.devpost.com (rules and overview, rechecked 2026-11-20).

## Required by the rules

| Item | Status | Owner |
|---|---|---|
| Eligibility: every team member is a student above the age of majority | confirm | you |
| Project name and overview | drafted in `submission/DEVPOST.md` | done |
| Problem and solution | drafted | done |
| AI implementation (models, frameworks) | drafted, with model sizes and training data | done |
| **Working demo link** with access instructions | live at https://cs113062273-bot.github.io/SLAY-HACKS/; production E2E passed; five live inputs passed again on amended source 3e47ac9 (VALIDATION.md) | agent |
| Screenshots | `submission/shots/` at 1500×1000 (3:2): landing, fabricated reference, wrong identifier, wrong details, retracted work, supported claim, needs-review claim, dark mode. Regenerate with `npx tsx scripts/shots.ts` | done; pick 4–6 |
| **Source repository** with docs and setup steps | README.md; repo `cs113062273-bot/SLAY-HACKS` | public repository confirmed |
| Disclose significant limitations and external dependencies | README "Responsible use" and DEVPOST "Limitations" | done |
| Description matches what the product actually does (misrepresentation = disqualification) | every claim is tied to a reproducible script | done |
| Third-party licences respected | models: MIT (DeBERTa-v3 NLI base), MIT (e5-small-v2); datasets cited | done |

## Recommended

| Item | Status |
|---|---|
| 2–4 minute demo video | script in `submission/DEMO_SCRIPT.md`; **recording needs your approval** (SKILL.md rule) |
| Built-with tags | listed in DEVPOST.md |
| Thumbnail / cover image | `submission/shots/3-wrong-identifier.png` (shows the core idea at a glance) |

## Before pressing Submit

1. Run `VERACITE_URL=https://cs113062273-bot.github.io/SLAY-HACKS/ npx tsx scripts/live-e2e.ts` (cross-origin isolation, site asset errors, samples, all five inputs, exports and claim support). `deploy-check.ts` is the shorter sample-only alternative. A private-window check on a second physical machine is still the owner's final check.
2. Run `VERACITE_URL=https://cs113062273-bot.github.io/SLAY-HACKS/ npx tsx scripts/privacy-audit.ts ../data/inputs/test.docx` against the live site: no non-GET requests and no body-text windows observed in requests. Reference metadata is expected to leave the device. These environment-variable examples use Bash; PowerShell uses `$env:VERACITE_URL='https://cs113062273-bot.github.io/SLAY-HACKS/'` first.
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

## Current acceptance gates (November 21)

- [x] Public push and free Pages deployment authorized; owner reports Pages enabled.
- [x] `npm run build` passes the actual application TypeScript project and production build. CI now uses that command.
- [x] Zenodo F1 .971; HALLMARK dev 310 rows F1 .986, FPR 0.
- [x] Frozen set-2 results and sampled misses disclosed; historical test results distinguished from current regressions.
- [x] Production URL responds; amended source 3e47ac9 build/deployment succeeded in workflow 44776807750.
- [x] Fresh-profile five-input E2E passes again on amended source 3e47ac9, without sample snapshots (production-inputs-amended.json).
- [x] Final-version production privacy audit passes on DOCX (3 refs, 2 claim tasks, 5 body windows); scope and unavailable source in VALIDATION.md.
- [x] Independent set 3 selection complete (14 PDFs, 67 rejected records); selection identity 497cb22 and separate pre-run audit freeze 3e47ac9 preserved.
- [x] Independent set 3 ran once at `3e47ac9` and every flag, the 70-reference field sample and the 42-reference miss sample were reviewed (`data/blind3/`, `docs/EVALUATION.md`).
- [x] Extraction completeness ≥95%: 964/969 (99.5%), 14/14 PDFs, no excess entries. Coverage 81.1% verified.
- [ ] False alarms ≤2%: **not met** (98/964, 10.2%; median paper 3.7%). Post-set-3 fixes are development results only (VALIDATION.md).
- [ ] A 95/100 readiness claim is not justified while the false-alarm gate fails on independent data.

Live target: https://cs113062273-bot.github.io/SLAY-HACKS/. No video will be recorded and no Devpost submission will be made without the owner's later instruction.
