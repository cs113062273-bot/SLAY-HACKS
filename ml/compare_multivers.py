"""Shipped verifier vs the released Citation-Integrity MultiVerS on the same claims and the same retrieved evidence
(our top-5), paper label mapping. Paired bootstrap (2000 resamples) for macro-F1 and binary supported-vs-not AUROC,
plus per fine-label rates. Usage: python compare_multivers.py --split dev|test"""
import argparse, collections, json
import numpy as np
from sklearn.metrics import f1_score, roc_auc_score
from ci_data import LABELS, load

ap = argparse.ArgumentParser(); ap.add_argument("--split", default="dev", choices=["dev"]); ap.add_argument("--extra", nargs="*", default=[]); a = ap.parse_args()
D = load(a.split, "paper"); y = np.array([LABELS.index(x["label"]) for x in D]); fine = [x["fine"] for x in D]
def sm(L): e = np.exp(L - L.max(1, keepdims=True)); return e / e.sum(1, keepdims=True)
bias = np.array([0, *json.load(open("../app/public/models/veracite-verifier/veracite.json"))["bias"]])
L = np.load(f"cache/{a.split}_logits_shipped.npy")
M = {"shipped (raw)": sm(L), "shipped (bias)": sm(L + bias), "MultiVerS-CI (our evidence)": np.load(f"cache/multivers_{a.split}-ours.npy")}
for e in a.extra: M[e] = np.load(e)
rng = np.random.default_rng(0); B = [rng.integers(0, len(y), len(y)) for _ in range(2000)]
ref = "MultiVerS-CI (our evidence)"
for name, P in M.items():
    p = P.argmax(1)
    print(f"{name:30s} micro {f1_score(y,p,average='micro'):.3f} macro {f1_score(y,p,average='macro'):.3f} per-class ACC/NOT/NEI {f1_score(y,p,average=None,labels=[0,1,2]).round(3).tolist()} binary AUROC {roc_auc_score(y==0,P[:,0]):.3f}")
    if name != ref:
        Q = M[ref]; q = Q.argmax(1)
        dm = [f1_score(y[b], p[b], average='macro') - f1_score(y[b], q[b], average='macro') for b in B]
        da = [roc_auc_score(y[b]==0, P[b,0]) - roc_auc_score(y[b]==0, Q[b,0]) for b in B]
        print(f"{'':30s} vs MultiVerS: macro diff {np.mean(dm):+.3f} [{np.percentile(dm,2.5):+.3f}, {np.percentile(dm,97.5):+.3f}]  AUROC diff {np.mean(da):+.3f} [{np.percentile(da,2.5):+.3f}, {np.percentile(da,97.5):+.3f}]")
print("\nper fine label: share predicted ACCURATE / NOT_ACCURATE / NEI")
for f, n in collections.Counter(fine).most_common():
    idx = [i for i, g in enumerate(fine) if g == f]
    print(f"  {f:20s} n={n:3d}  " + "  ".join(f"{k.split(' ')[0][:9]} {np.bincount(M[k].argmax(1)[idx], minlength=3).round(2).tolist()}" for k in M))
