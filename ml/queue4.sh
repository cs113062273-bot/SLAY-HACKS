#!/bin/bash
# Re-run the ablation arms that crashed in queue3 (e2 segfault after epoch 1, e0 OOM). Dev-only selection.
cd "$(dirname "$0")"
PY=.venv/Scripts/python
export PYTHONIOENCODING=utf-8
[ -f runs/deb_base_sf_k26.ea ] || $PY error_analysis.py --model runs/deb_base_sf_k26/best > runs/deb_base_sf_k26.ea 2>&1
for cfg in "e2b_perturb_mnli:--perturb 1.0 --mnli 12000" "e0_base:"; do
  name=${cfg%%:*}; extra=${cfg#*:}
  rm -rf runs/$name
  $PY train_verifier.py --model MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli --k 5 --k_range 2-6 --epochs 4 --bs 2 --accum 8 --grad_ckpt --scifact $extra --out runs/$name > runs/$name.log 2>&1
  [ -d runs/$name/best ] || continue
  $PY error_analysis.py --model runs/$name/best > runs/$name.ea 2>&1
  $PY semcite.py --model runs/$name/best > runs/$name.semcite 2>&1
  $PY probes.py runs/$name/best > runs/$name.probes 2>&1
done
echo done > runs/queue4.done
