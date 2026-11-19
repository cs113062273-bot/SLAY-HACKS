#!/bin/bash
# Ablation: baseline (clean claims) vs +synthetic misrepresentations vs +NLI replay. Dev-only selection.
cd "$(dirname "$0")"
PY=.venv/Scripts/python
export PYTHONIOENCODING=utf-8
# contexts already built (runs/ctx_clean.log)
for cfg in "e0_base:" "e1_perturb:--perturb 1.0" "e2_perturb_mnli:--perturb 1.0 --mnli 12000"; do
  name=${cfg%%:*}; extra=${cfg#*:}
  $PY train_verifier.py --model MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli --k 5 --k_range 2-6 --epochs 4 --bs 2 --accum 8 --grad_ckpt --scifact $extra --out runs/$name > runs/$name.log 2>&1
  [ -d runs/$name/best ] || continue
  $PY error_analysis.py --model runs/$name/best > runs/$name.ea 2>&1
  $PY semcite.py --model runs/$name/best > runs/$name.semcite 2>&1
  $PY probes.py runs/$name/best > runs/$name.probes 2>&1
done
echo done > runs/queue3.done
