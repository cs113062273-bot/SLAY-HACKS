#!/bin/bash
# Ship a trained verifier to the web app: prune vocabulary → ONNX → 4-bit → copy into app/public/models.
# Usage: ./ship.sh runs/deb_base_all
set -e
cd "$(dirname "$0")"
PY=.venv/Scripts/python
export PYTHONIOENCODING=utf-8
RUN=$1
$PY prune_vocab.py --run "$RUN" --out "${RUN}_pruned" --min_count 3
$PY export_onnx.py --run "${RUN}_pruned" --out "${RUN}_pruned/web"
rm -rf ../app/public/models/veracite-verifier
mkdir -p ../app/public/models
cp -r "${RUN}_pruned/web" ../app/public/models/veracite-verifier
ls -la ../app/public/models/veracite-verifier/onnx
