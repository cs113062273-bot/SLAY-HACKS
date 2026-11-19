"""Precision of each displayed label vs confidence threshold (shipped q4 model, CI dev)."""
import json, numpy as np, onnxruntime as ort
from pathlib import Path
from transformers import AutoTokenizer
from train_verifier import build
d = Path("../app/public/models/veracite-verifier"); meta = json.load(open(d / "veracite.json"))
tok = AutoTokenizer.from_pretrained(d); s = ort.InferenceSession(str(d / "onnx/model_q4.onnx"), providers=["CPUExecutionProvider"])
names = {i.name for i in s.get_inputs()}
rows = build("dev", meta["k"]); y = np.array([r[2] for r in rows]); L = []
for c, e, _ in rows:
    enc = tok(c, e, truncation="only_second", max_length=512, return_tensors="np")
    L.append(s.run(None, {n: enc[n].astype(np.int64) for n in names if n in enc})[0][0])
P = np.exp(np.array(L)); P /= P.sum(1, keepdims=True); np.save("cache/dev_probs_shipped.npy", P)
names3 = ["ACCURATE", "NOT_ACCURATE", "NEI"]
print("base rates:", {n: round(float((y == i).mean()), 2) for i, n in enumerate(names3)})
for k, n in enumerate(names3):
    for t in [0.34, 0.5, 0.7, 0.8, 0.9, 0.95]:
        m = (P.argmax(1) == k) & (P[:, k] >= t)
        if m.sum(): print(f"{n:13s} p>={t:.2f}: n={m.sum():3d} precision={(y[m] == k).mean():.2f}  recall={(m & (y == k)).sum() / max(1, (y == k).sum()):.2f}")
# "problem" = NOT_ACC or NEI together
prob = P[:, 1] + P[:, 2]
for t in [0.5, 0.7, 0.8, 0.9, 0.95]:
    m = prob >= t
    print(f"PROBLEM (not acc or nei) p>={t:.2f}: n={m.sum():3d} precision={(y[m] != 0).mean():.2f} recall={(m & (y != 0)).sum() / (y != 0).sum():.2f}")
