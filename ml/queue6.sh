#!/bin/bash
# Amendment 1 arm (data/claim_v2/PROTOCOL.md): A1 + HealthVer. Runs after queue5.
cd "$(dirname "$0")"
PY=.venv/Scripts/python
export PYTHONIOENCODING=utf-8 CI_MAP=paper
while [ ! -f runs/queue5.done ]; do sleep 60; done
name=v2_a3_healthver
[ -d runs/$name/best ] || $PY train_verifier.py --model MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli --k 5 --k_range 2-6 --epochs 4 --bs 2 --accum 8 --grad_ckpt --scifact --healthver 4000 --out runs/$name > runs/$name.log 2>&1
[ -d runs/$name/best ] && $PY semcite.py --model runs/$name/best > runs/$name.semcite 2>&1 && $PY probes.py runs/$name/best > runs/$name.probes 2>&1
echo done > runs/queue6.done
