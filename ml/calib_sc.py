import json, numpy as np, onnxruntime as ort
from pathlib import Path
from transformers import AutoTokenizer
from semcite import load, evidence_text
d = Path("../app/public/models/veracite-verifier")
tok = AutoTokenizer.from_pretrained(d); s = ort.InferenceSession(str(d / "onnx/model_q4.onnx"), providers=["CPUExecutionProvider"])
names = {i.name for i in s.get_inputs()}
te = load("test"); P = []; lab = []
for e in te:
    enc = tok(e["input"]["claim"], evidence_text(e), truncation="only_second", max_length=512, return_tensors="np")
    l = s.run(None, {n: enc[n].astype(np.int64) for n in names if n in enc})[0][0]; p = np.exp(l - l.max()); P.append(p / p.sum()); lab.append(e["output"]["classification"])
P = np.array(P); lab = np.array(lab)
for t in [0.8, 0.9, 0.95, 0.98]:
    rv = (P[:, 1] + P[:, 2]) >= t
    print(f"review p>={t}: flagged {rv.sum()}/{len(P)} | flag rate SUPPORTED={rv[lab=='SUPPORTED'].mean():.2f} PARTIAL={rv[lab=='PARTIALLY_SUPPORTED'].mean():.2f} UNSUPPORTED={rv[lab=='UNSUPPORTED'].mean():.2f} | precision(unsup)={(lab[rv]=='UNSUPPORTED').mean():.2f}")
for t in [0.5, 0.7]:
    sp = (P[:, 0] >= t)
    print(f"supported p>={t}: precision(sup or partial)={(np.isin(lab[sp], ['SUPPORTED','PARTIALLY_SUPPORTED'])).mean():.2f} n={sp.sum()}")
