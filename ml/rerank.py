"""Evidence reranker: fine-tune a small cross-encoder on Citation-Integrity gold evidence.

Candidates = top-N from hybrid retrieval (e5-small-v2 + BM25, RRF). Positives = gold sentences,
negatives = retrieved non-gold sentences (hard negatives). Evaluated by Recall@k / Hit@k on dev.

Usage: python rerank.py --base cross-encoder/ms-marco-MiniLM-L6-v2 --epochs 2 --out runs/reranker
       python rerank.py --base cross-encoder/ms-marco-MiniLM-L6-v2 --zero_shot
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

from ci_data import load
from retrieval import Dense, bm25_scores, rrf

CACHE = Path(__file__).parent / "cache"
DENSE = "intfloat/e5-small-v2"


def candidates(split, D, n=30):
    p = CACHE / f"cands_{split}_{DENSE.split('/')[-1]}.json"
    if p.exists():
        return json.load(open(p))
    data = load(split)
    out = {}
    doc_cache = {}
    for x in data:
        key = (len(x["sents"]),) + tuple(x["sents"][:2])
        if key not in doc_cache:
            doc_cache[key] = D.enc([D.dp + s for s in x["sents"]])
        q = D.enc([D.qp + x["claim"]])[0]
        fused = rrf(doc_cache[key] @ q, bm25_scores(x["claim"], x["sents"]))
        out[str(x["id"])] = np.argsort(-fused)[:n].tolist()
    json.dump(out, open(p, "w"))
    return out


@torch.no_grad()
def score(model, tok, claim, sents, device, bs=64):
    out = []
    for i in range(0, len(sents), bs):
        b = tok([claim] * len(sents[i : i + bs]), sents[i : i + bs], truncation=True, max_length=256, padding=True, return_tensors="pt").to(device)
        with torch.autocast("cuda", dtype=torch.float16, enabled=device == "cuda"):
            lg = model(**b).logits.float()
        out.append(lg[:, -1] if lg.shape[1] > 1 else lg[:, 0])
    return torch.cat(out).cpu().numpy()


def evaluate(model, tok, data, cands, device, ks=(1, 3, 5, 10)):
    model.eval()
    rec = {k: [] for k in ks}
    hit = {k: [] for k in ks}
    for x in data:
        if not x["gold"]:
            continue
        c = cands[str(x["id"])]
        s = score(model, tok, x["claim"], [x["sents"][i] for i in c], device)
        order = [c[i] for i in np.argsort(-s)]
        for k in ks:
            top = set(order[:k])
            rec[k].append(len(top & x["gold"]) / len(x["gold"]))
            hit[k].append(1.0 if top & x["gold"] else 0.0)
    return {k: (round(float(np.mean(rec[k])), 3), round(float(np.mean(hit[k])), 3)) for k in ks}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="cross-encoder/ms-marco-MiniLM-L6-v2")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--neg", type=int, default=8)
    ap.add_argument("--zero_shot", action="store_true")
    ap.add_argument("--out", default="runs/reranker")
    a = ap.parse_args()
    random.seed(0)
    torch.manual_seed(0)
    device = "cuda"
    D = Dense(DENSE, device)
    cands = {s: candidates(s, D) for s in ["train", "dev"]}
    del D
    tok = AutoTokenizer.from_pretrained(a.base)
    model = AutoModelForSequenceClassification.from_pretrained(a.base).to(device)
    dev = load("dev")
    print("zero-shot dev:", evaluate(model, tok, dev, cands["dev"], device), flush=True)
    if a.zero_shot:
        return
    train = load("train")
    pairs = []
    for x in train:
        if not x["gold"]:
            continue
        c = cands["train"][str(x["id"])]
        negs = [i for i in c if i not in x["gold"]][: a.neg * 2]
        for g in x["gold"]:
            pairs.append((x["claim"], x["sents"][g], 1.0))
        for n in random.sample(negs, min(a.neg, len(negs))):
            pairs.append((x["claim"], x["sents"][n], 0.0))
    print("train pairs", len(pairs))
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01)
    bs = 32
    steps = (len(pairs) // bs + 1) * a.epochs
    sch = get_linear_schedule_with_warmup(opt, int(0.1 * steps), steps)
    lossf = torch.nn.BCEWithLogitsLoss()
    best = -1
    for ep in range(a.epochs):
        model.train()
        random.shuffle(pairs)
        for i in range(0, len(pairs), bs):
            b = pairs[i : i + bs]
            enc = tok([p[0] for p in b], [p[1] for p in b], truncation=True, max_length=256, padding=True, return_tensors="pt").to(device)
            y = torch.tensor([p[2] for p in b], device=device)
            with torch.autocast("cuda", dtype=torch.float16):
                lg = model(**enc).logits.float()
            loss = lossf(lg[:, -1] if lg.shape[1] > 1 else lg[:, 0], y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            opt.zero_grad()
            sch.step()
        r = evaluate(model, tok, dev, cands["dev"], device)
        print(f"epoch {ep+1} dev:", r, flush=True)
        if r[5][0] > best:
            best = r[5][0]
            model.save_pretrained(a.out)
            tok.save_pretrained(a.out)


if __name__ == "__main__":
    main()
