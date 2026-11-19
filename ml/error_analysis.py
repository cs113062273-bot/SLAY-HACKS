"""Error analysis of a verifier on Citation-Integrity DEV (never test):
confusion matrix, retrieval hit/miss split, oracle-evidence upper bound, recall by fine error type.
Usage: python error_analysis.py --model runs/deb_base_sf_k26/best
"""
import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import confusion_matrix, f1_score
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from ci_data import LABELS, load

CACHE = Path(__file__).parent / "cache"


@torch.no_grad()
def predict(model, tok, pairs, bs=16):
    out = []
    for i in range(0, len(pairs), bs):
        b = pairs[i : i + bs]
        enc = tok([x[0] for x in b], [x[1] for x in b], truncation="longest_first", max_length=512, padding=True, return_tensors="pt").to("cuda")
        with torch.autocast("cuda", dtype=torch.bfloat16):
            out.append(torch.softmax(model(**enc).logits.float(), -1).cpu().numpy())
    return np.concatenate(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--k", type=int, default=5)
    a = ap.parse_args()
    tok = AutoTokenizer.from_pretrained(a.model)
    model = AutoModelForSequenceClassification.from_pretrained(a.model).to("cuda").eval()
    data = load("dev")
    ctx = {c["id"]: c["order"] for c in json.load(open(CACHE / "contexts_dev.json"))}
    y = np.array([LABELS.index(x["label"]) for x in data])
    ret_pairs, gold_pairs, hit = [], [], []
    for x in data:
        order = ctx[x["id"]][: a.k]
        ret_pairs.append((x["claim"], " ".join(x["sents"][i] for i in sorted(order))))
        g = sorted(x["gold"])[: a.k]
        gold_pairs.append((x["claim"], " ".join(x["sents"][i] for i in g)) if g else ret_pairs[-1])
        hit.append(bool(set(order) & x["gold"]) if x["gold"] else None)
    P = predict(model, tok, ret_pairs)
    G = predict(model, tok, gold_pairs)
    p = P.argmax(1)
    f = lambda yy, pp: f1_score(yy, pp, average=None, labels=[0, 1, 2]).round(3).tolist()
    print("RETRIEVED  macro", round(f1_score(y, p, average="macro"), 3), "per-class", f(y, p))
    print("ORACLE     macro", round(f1_score(y, G.argmax(1), average="macro"), 3), "per-class", f(y, G.argmax(1)))
    print("confusion (rows=gold ACC/NOT/NEI):\n", confusion_matrix(y, p))
    hit = np.array([h if h is not None else False for h in hit])
    has_gold = np.array([bool(x["gold"]) for x in data])
    for name, m in [("gold retrieved (hit)", has_gold & hit), ("gold missed", has_gold & ~hit)]:
        print(f"{name:22s} n={m.sum():3d} acc={(p[m] == y[m]).mean():.3f}  NOT_ACC recall={((p == 1) & (y == 1) & m).sum()}/{((y == 1) & m).sum()}")
    by = defaultdict(list)
    for x, pi in zip(data, p):
        by[x["fine"]].append(pi)
    print("prediction distribution by fine label (ACC/NOT/NEI):")
    for k, v in sorted(by.items(), key=lambda kv: -len(kv[1])):
        c = Counter(v)
        print(f"  {k:20s} n={len(v):3d}  ->", [c.get(i, 0) for i in range(3)])
    # does P(NOT_ACC) rank NOT_ACC examples above others at all? (AUROC)
    from sklearn.metrics import roc_auc_score

    print("AUROC NOT_ACC vs rest:", round(roc_auc_score(y == 1, P[:, 1]), 3), "| oracle:", round(roc_auc_score(y == 1, G[:, 1]), 3))
    print("AUROC ACC vs rest:", round(roc_auc_score(y == 0, P[:, 0]), 3), "| AUROC NEI vs rest:", round(roc_auc_score(y == 2, P[:, 2]), 3))


if __name__ == "__main__":
    main()
