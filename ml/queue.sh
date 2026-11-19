#!/bin/bash
# Sequential GPU experiment queue (dev-selected; test is scored once at the end)
cd "$(dirname "$0")"
PY=.venv/Scripts/python
export PYTHONIOENCODING=utf-8
while pgrep -f "deb_base_k10" > /dev/null || tasklist 2>/dev/null | grep -q "python.exe" && grep -q '"epoch": 3' runs/deb_base_k10.log && ! grep -q '"epoch": 4' runs/deb_base_k10.log; do sleep 30; done
until grep -q '"epoch": 4' runs/deb_base_k10.log; do sleep 30; done
$PY train_verifier.py --model MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli --k 5 --epochs 4 --scifact --out runs/deb_base_k5_sf > runs/deb_base_k5_sf.log 2>&1
$PY train_verifier.py --model lytang/MiniCheck-DeBERTa-v3-Large --k 5 --epochs 3 --bs 2 --accum 8 --lr 1e-5 --out runs/minicheck_large_k5 > runs/minicheck_large_k5.log 2>&1
$PY train_verifier.py --model cross-encoder/nli-deberta-v3-small --k 5 --epochs 5 --lr 3e-5 --out runs/deb_small_k5 > runs/deb_small_k5.log 2>&1
echo QUEUE_DONE > runs/queue.done
