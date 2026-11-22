# Claim verifier v2: pre-registration (written 2026-11-22, before any v2 training run)

## Finding that motivates v2

The shipped verifier (`deb_base_sf_k26`) was trained and scored with a label mapping that differs from Sarol et al. (2024).
`ml/ci_data.py` read the multivers-format files, where a citation without evidence segments has no label, and mapped all
of them to NEI. The raw annotations (`annotations.zip`) show these are ETIQUETTE (300 train / 37 dev / 70 test) or
IRRELEVANT (142 / 24 / 49). The paper maps ETIQUETTE to NOT_ACCURATE. The authors' released training files
(`scifact_10`, Google Drive) confirm it: test = 386 ACCURATE / 170 NOT_ACCURATE / 50 NEI, which matches `load('test', 'paper')` exactly.
So "NOT_ACCURATE F1 .152 vs MultiVerS .43" compared different tasks.

Shipped model re-scored under the paper mapping (same predictions, `ml/rescore_paper.py`, no selection):
test micro .573 / macro .417, per class ACC .760 / NOT .161 / NEI .330 (raw argmax; with the shipped bias .606 / .432).
MultiVerS top-20 (paper Table 4): .59 / .52, per class .69 / .43 / .42. Binary supported-vs-not (mapping-invariant, what the
product's triage uses): test AUROC .726, dev .765.

## Arms (all trained on CI train with `CI_MAP=paper`, otherwise the shipped recipe: k=5, k_range 2-6, SciFact aux, 4 epochs, seed 13)

- A1: DeBERTa-v3-base-mnli-fever-anli (same backbone as shipped). Isolates the label-mapping fix.
- A2: DeBERTa-v3-large-mnli-fever-anli-ling-wanli, same data. Capacity arm; browser cost measured if it passes the gates.
- Baseline: the authors' released MultiVerS checkpoint run on their own released inputs (dev and test), scored with
  the same code as our models (reproduction of Table 4 and binary AUROC).

## Selection (dev and SemanticCite only) and shipping gates, fixed now

An arm can replace the shipped model only if all hold:
1. Dev macro-F1 under the paper mapping (raw argmax) beats the shipped .411, with paired-bootstrap 95% CI above 0.
2. Dev binary supported-vs-not AUROC ≥ .745 (shipped .765 minus .02).
3. SemanticCite held-out AUROC ≥ .817 (shipped .837 minus .02). No relaxation after seeing results.
4. Browser: 4-bit model ≤ 300 MB and ≤ 1.5 s per claim on WASM (only checked for A2).
If both arms pass, the one with the higher dev macro-F1 is chosen. The shipping decision is made before test.

## Test

The chosen arm (or none) is scored once on CI test under the paper mapping and reported as is, with the history disclosed:
CI test was scored before for two models under the old mapping. The MultiVerS reproduction is scored on the same test.
