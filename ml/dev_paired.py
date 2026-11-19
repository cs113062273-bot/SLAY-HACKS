"""Paired bootstrap of CI DEV macro-F1 / NOT_ACC F1 difference between two checkpoints (never test)."""
import sys, json, numpy as np, torch
from sklearn.metrics import f1_score
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from ci_data import LABELS, load
from error_analysis import predict, CACHE
data = load("dev"); ctx = {c["id"]: c["order"] for c in json.load(open(CACHE / "contexts_dev.json"))}
y = np.array([LABELS.index(x["label"]) for x in data])
pairs = [(x["claim"], " ".join(x["sents"][i] for i in sorted(ctx[x["id"]][:5]))) for x in data]
preds = []
for m in sys.argv[1:3]:
    tok = AutoTokenizer.from_pretrained(m); mod = AutoModelForSequenceClassification.from_pretrained(m).to("cuda").eval()
    preds.append(predict(mod, tok, pairs).argmax(1)); del mod; torch.cuda.empty_cache()
a, b = preds
rng = np.random.default_rng(0); dm, dn = [], []
for _ in range(5000):
    i = rng.integers(0, len(y), len(y))
    dm.append(f1_score(y[i], b[i], average="macro") - f1_score(y[i], a[i], average="macro"))
    dn.append(f1_score(y[i] == 1, b[i] == 1) - f1_score(y[i] == 1, a[i] == 1))
for n, d in [("macro", dm), ("NOT_ACC F1", dn)]:
    d = np.array(d); print(f"{n}: diff={d.mean():+.3f} 95%CI [{np.percentile(d,2.5):+.3f}, {np.percentile(d,97.5):+.3f}] P(B<=A)={np.mean(d<=0):.3f}")
