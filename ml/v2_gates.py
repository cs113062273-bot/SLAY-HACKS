"""Gate check for claim verifier v2 arms (data/claim_v2/PROTOCOL.md), dev + SemanticCite only, paper label mapping.
Writes cache/dev_logits_<arm>.npy. Usage: python v2_gates.py runs/v2_a1_base [runs/v2_a2_large ...]"""
import ast, sys
from pathlib import Path
import numpy as np, torch
from sklearn.metrics import f1_score, roc_auc_score
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from ci_data import LABELS, load
from train_verifier import build

y = np.array([LABELS.index(x["label"]) for x in load("dev", "paper")])
rows = build("dev", 5)  # same evidence the shipped model is scored with (k=5)
def sm(L): e = np.exp(L - L.max(1, keepdims=True)); return e / e.sum(1, keepdims=True)
S = np.load("cache/dev_logits_shipped.npy"); ps = S.argmax(1)
rng = np.random.default_rng(0); B = [rng.integers(0, len(y), len(y)) for _ in range(2000)]
print(f"shipped: dev macro {f1_score(y, ps, average='macro'):.3f} AUROC {roc_auc_score(y==0, sm(S)[:,0]):.3f}")
for run in sys.argv[1:]:
    d = Path(run) / "best"; tag = Path(run).name
    tok = AutoTokenizer.from_pretrained(d); m = AutoModelForSequenceClassification.from_pretrained(d).cuda().eval()
    L = []
    with torch.no_grad():
        for i in range(0, len(rows), 16):
            b = rows[i : i + 16]
            enc = tok([r[0] for r in b], [r[1] for r in b], truncation="only_second", max_length=512, padding=True, return_tensors="pt").to("cuda")
            with torch.autocast("cuda", dtype=torch.float16):
                L.append(m(**enc).logits.float().cpu().numpy())
    L = np.concatenate(L); np.save(f"cache/dev_logits_{tag}.npy", L); p = L.argmax(1)
    macro = f1_score(y, p, average="macro"); auc = roc_auc_score(y == 0, sm(L)[:, 0])
    dm = np.array([f1_score(y[b], p[b], average="macro") - f1_score(y[b], ps[b], average="macro") for b in B])
    sc = Path(f"{run}.semcite"); sem = ast.literal_eval(sc.read_text().strip().splitlines()[-1].split(" ", 1)[1])["auroc"] if sc.exists() else float("nan")
    g1, g2, g3 = np.percentile(dm, 2.5) > 0, auc >= .745, sem >= .817
    print(f"{tag}: dev macro {macro:.3f} per-class {f1_score(y,p,average=None).round(3).tolist()} diff {dm.mean():+.3f} [{np.percentile(dm,2.5):+.3f}, {np.percentile(dm,97.5):+.3f}] | AUROC {auc:.3f} | semcite {sem:.3f} | gates macro {g1} auroc {g2} semcite {g3} -> {'PASS' if g1 and g2 and g3 else 'FAIL'}")
    del m; torch.cuda.empty_cache()
