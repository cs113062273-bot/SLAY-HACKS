#!/bin/bash
# A2 (large) after A3; runs/v2_a2_large/best was a placeholder so queue5 skipped it.
cd "$(dirname "$0")"
PY=.venv/Scripts/python
export PYTHONIOENCODING=utf-8 CI_MAP=paper
while [ ! -f runs/queue6.done ]; do sleep 60; done
name=v2_a2_large
[ -f runs/$name/PLACEHOLDER ] && rm -rf runs/$name
$PY train_verifier.py --model MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli --k 5 --k_range 2-6 --epochs 4 --bs 2 --accum 8 --grad_ckpt --scifact --out runs/$name > runs/$name.log 2>&1
[ -d runs/$name/best ] && $PY semcite.py --model runs/$name/best > runs/$name.semcite 2>&1 && $PY probes.py runs/$name/best > runs/$name.probes 2>&1
echo done > runs/queue7.done
