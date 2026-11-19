"""SemanticCite (Haan 2025; HF sebsigma/SemanticCite-Dataset): cross-domain claim-support pairs.

Deterministic 70/30 split by claim hash. Evaluation = AUROC of P(ACCURATE) on SUPPORTED vs UNSUPPORTED
(held-out 30%), plus accuracy at argmax. Training rows: SUPPORTED→ACCURATE, UNSUPPORTED→NOT_ACCURATE.

Usage: python semcite.py --model runs/deb_base_k5/best        (evaluate a checkpoint)
       python semcite.py --model MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli --nli   (zero-shot NLI)
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import roc_auc_score
from transformers import AutoModelForSequenceClassification, AutoTokenizer

PATH = Path(__file__).resolve().parent.parent / "data" / "semanticcite" / "SemanticCite_dataset.json"


def split_of(claim: str) -> str:
    return "test" if int(hashlib.md5(claim.encode("utf-8")).hexdigest(), 16) % 10 < 3 else "train"


def evidence_text(e, k=5):
    sn = sorted(e["input"]["ref_snippets"], key=lambda s: -s.get("relevance_score", 0))[:k]
    return " ".join(" ".join(s["text"].split()) for s in sn)


def load(split):
    data = json.load(open(PATH, encoding="utf-8"))
    return [e for e in data if split_of(e["input"]["claim"]) == split]


def train_rows(k=5):
    rows = []
    for e in load("train"):
        lab = e["output"]["classification"]
        if lab == "SUPPORTED":
            rows.append((e["input"]["claim"], evidence_text(e, k), 0))
        elif lab == "UNSUPPORTED":
            rows.append((e["input"]["claim"], evidence_text(e, k), 1))
    return rows


@torch.no_grad()
def support_scores(model_path, pairs, nli=False, device="cuda"):
    tok = AutoTokenizer.from_pretrained(model_path)
    m = AutoModelForSequenceClassification.from_pretrained(model_path).to(device).eval()
    ent = None
    if nli:
        ent = [i for i, l in m.config.id2label.items() if "entail" in l.lower()][0]
    out = []
    for i in range(0, len(pairs), 16):
        b = pairs[i : i + 16]
        # NLI convention: premise (evidence) first, hypothesis (claim) second
        enc = tok([x[1] for x in b], [x[0] for x in b], truncation="only_first", max_length=512, padding=True, return_tensors="pt") if nli else tok([x[0] for x in b], [x[1] for x in b], truncation="only_second", max_length=512, padding=True, return_tensors="pt")
        enc = {k: v.to(device) for k, v in enc.items()}
        with torch.autocast("cuda", dtype=torch.float16):
            p = torch.softmax(m(**enc).logits.float(), -1).cpu().numpy()
        out.extend(p[:, ent] if nli else p[:, 0])
    return np.array(out)


def evaluate(model_path, nli=False):
    te = [e for e in load("test") if e["output"]["classification"] in ("SUPPORTED", "UNSUPPORTED")]
    pairs = [(e["input"]["claim"], evidence_text(e)) for e in te]
    y = np.array([1 if e["output"]["classification"] == "SUPPORTED" else 0 for e in te])
    s = support_scores(model_path, pairs, nli)
    return {"n": len(te), "auroc": round(float(roc_auc_score(y, s)), 3), "acc@0.5": round(float(((s >= 0.5) == y).mean()), 3)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--nli", action="store_true")
    a = ap.parse_args()
    print(a.model, evaluate(a.model, a.nli))
