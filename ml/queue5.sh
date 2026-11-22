#!/bin/bash
# Claim verifier v2 arms (data/claim_v2/PROTOCOL.md): paper label mapping. Dev/SemanticCite selection only.
cd "$(dirname "$0")"
PY=.venv/Scripts/python
export PYTHONIOENCODING=utf-8 CI_MAP=paper
while [ ! -f cache/multivers_test-ours.npy ]; do sleep 20; done
for cfg in "v2_a1_base:MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli" "v2_a2_large:MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli"; do
  name=${cfg%%:*}; model=${cfg#*:}
  [ -d runs/$name/best ] && continue
  $PY train_verifier.py --model $model --k 5 --k_range 2-6 --epochs 4 --bs 2 --accum 8 --grad_ckpt --scifact --out runs/$name > runs/$name.log 2>&1
  [ -d runs/$name/best ] || continue
  $PY semcite.py --model runs/$name/best > runs/$name.semcite 2>&1
  $PY probes.py runs/$name/best > runs/$name.probes 2>&1
done
echo done > runs/queue5.done
