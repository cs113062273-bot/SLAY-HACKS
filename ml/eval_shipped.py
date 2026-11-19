"""Evaluate the *shipped* browser model (pruned vocab, 4-bit ONNX) on a Citation-Integrity split,
with the metrics of Sarol et al. (2024): per-class F1, micro-F1, macro-F1.

Usage: python eval_shipped.py --model ../app/public/models/veracite-verifier --split test
"""
import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from sklearn.metrics import classification_report, f1_score
from transformers import AutoTokenizer

from ci_data import LABELS
from train_verifier import build

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--split", default="dev")
    a = ap.parse_args()
    d = Path(a.model)
    meta = json.load(open(d / "veracite.json"))
    tok = AutoTokenizer.from_pretrained(d)
    sess = ort.InferenceSession(str(d / "onnx" / "model_q4.onnx"), providers=["CPUExecutionProvider"])
    names = {i.name for i in sess.get_inputs()}
    rows = build(a.split, meta["k"])
    L = []
    for c, e, _ in rows:
        enc = tok(c, e, truncation="longest_first", max_length=512, return_tensors="np")  # same as the browser
        L.append(sess.run(None, {n: enc[n].astype(np.int64) for n in names if n in enc})[0][0])
    L = np.array(L)
    y = np.array([r[2] for r in rows])
    p = L.argmax(1)
    print(f"{a.split} n={len(y)}  micro-F1={f1_score(y, p, average='micro'):.3f}  macro-F1={f1_score(y, p, average='macro'):.3f}")
    print(classification_report(y, p, target_names=LABELS, digits=3))
