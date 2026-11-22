"""Re-score the shipped verifier (fixed predictions, no selection) under the paper's label mapping, so its numbers are
comparable with Sarol et al. Table 4. Also the binary 'supported vs not' view the product uses (mapping-invariant).
Usage: python rescore_paper.py --split dev|test   (writes cache/<split>_logits_shipped.npy once)"""
import argparse, json
from pathlib import Path
import numpy as np
from sklearn.metrics import f1_score, roc_auc_score
from ci_data import LABELS, load

ap = argparse.ArgumentParser(); ap.add_argument("--split", default="dev"); a = ap.parse_args()
cache = Path("cache") / f"{a.split}_logits_shipped.npy"
if not cache.exists():
    import onnxruntime as ort
    from transformers import AutoTokenizer
    from train_verifier import build
    d = Path("../app/public/models/veracite-verifier")
    meta = json.load(open(d / "veracite.json")); tok = AutoTokenizer.from_pretrained(d)
    sess = ort.InferenceSession(str(d / "onnx" / "model_q4.onnx"), providers=["CPUExecutionProvider"])
    names = {i.name for i in sess.get_inputs()}
    L = []
    for c, e, _ in build(a.split, meta["k"]):
        enc = tok(c, e, truncation="longest_first", max_length=512, return_tensors="np")
        L.append(sess.run(None, {n: enc[n].astype(np.int64) for n in names if n in enc})[0][0])
    np.save(cache, np.array(L))
L = np.load(cache); p = L.argmax(1)
for m in ["legacy", "paper"]:
    y = np.array([LABELS.index(x["label"]) for x in load(a.split, m)])
    pc = f1_score(y, p, average=None, labels=[0, 1, 2])
    print(f"{a.split} {m:6s} n={len(y)} counts={np.bincount(y).tolist()} micro {f1_score(y,p,average='micro'):.3f} macro {f1_score(y,p,average='macro'):.3f} per-class ACC/NOT/NEI {pc.round(3).tolist()}")
    # paper mapping, collapse NEI prediction for a no-evidence citation into NOT_ACC is NOT done: model is scored as is
pr = np.exp(L - L.max(1, keepdims=True)); pr /= pr.sum(1, keepdims=True)
yb = np.array([x["label"] == "ACCURATE" for x in load(a.split)])
print(f"{a.split} binary supported-vs-not: AUROC {roc_auc_score(yb, pr[:,0]):.3f}  F1(not-supported) {f1_score(~yb, pr[:,0]<.5):.3f}  F1(supported) {f1_score(yb, pr[:,0]>=.5):.3f}")
