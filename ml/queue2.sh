#!/bin/bash
cd "$(dirname "$0")"
PY=.venv/Scripts/python
export PYTHONIOENCODING=utf-8
until grep -q '"epoch": 4' runs/deb_base_k5_sf.log; do sleep 30; done
sleep 60
$PY train_verifier.py --model MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli --k 5 --k_range 1-7 --epochs 4 --scifact --semcite --out runs/deb_base_all > runs/deb_base_all.log 2>&1
$PY probes.py runs/deb_base_all/best > runs/deb_base_all.probes 2>&1
$PY semcite.py --model runs/deb_base_all/best > runs/deb_base_all.semcite 2>&1
echo done > runs/queue2.done
