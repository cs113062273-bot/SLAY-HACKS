"""Evidence retrieval experiments on Citation-Integrity: BM25 vs dense vs hybrid (RRF).

Usage: python retrieval.py --split dev --dense BAAI/bge-small-en-v1.5
Reports Recall@k (fraction of gold sentences retrieved) and Hit@k (>=1 gold retrieved).
"""
import argparse
import re

import numpy as np
import torch
from rank_bm25 import BM25Okapi
from transformers import AutoModel, AutoTokenizer

from ci_data import load

STOP = set("a an the of for and in on to with by from at via as is are was were be been this that these those it its into or than".split())


def tok(s):
    return [t for t in re.findall(r"[a-z0-9]+", s.lower()) if t not in STOP]


def bm25_scores(claim, sents):
    bm = BM25Okapi([tok(s) or ["_"] for s in sents])
    return np.array(bm.get_scores(tok(claim)))


class Dense:
    def __init__(self, name, device):
        self.tok = AutoTokenizer.from_pretrained(name)
        self.model = AutoModel.from_pretrained(name).to(device).eval().half()
        self.device = device
        self.name = name
        self.qp = "query: " if "e5" in name else ("Represent this sentence for searching relevant passages: " if "bge" in name and "en-v1.5" in name else "")
        self.dp = "passage: " if "e5" in name else ""

    @torch.no_grad()
    def enc(self, texts, bs=128):
        out = []
        for i in range(0, len(texts), bs):
            b = self.tok(texts[i : i + bs], padding=True, truncation=True, max_length=256, return_tensors="pt").to(self.device)
            h = self.model(**b).last_hidden_state
            if "bge" in self.name:
                e = h[:, 0]
            else:
                m = b["attention_mask"].unsqueeze(-1).to(h.dtype)
                e = (h * m).sum(1) / m.sum(1)
            out.append(torch.nn.functional.normalize(e.float(), dim=-1).cpu())
        return torch.cat(out).numpy()

    def scores(self, claim, sents):
        q = self.enc([self.qp + claim])[0]
        d = self.enc([self.dp + s for s in sents])
        return d @ q


def rrf(*score_lists, k=60):
    tot = np.zeros(len(score_lists[0]))
    for s in score_lists:
        ranks = np.argsort(-s).argsort()
        tot += 1.0 / (k + ranks + 1)
    return tot


def evaluate(data, scorer, ks=(1, 3, 5, 10, 20)):
    rec = {k: [] for k in ks}
    hit = {k: [] for k in ks}
    for x in data:
        if not x["gold"]:
            continue
        s = scorer(x)
        order = np.argsort(-s)
        for k in ks:
            top = set(order[:k].tolist())
            g = x["gold"]
            rec[k].append(len(top & g) / len(g))
            hit[k].append(1.0 if top & g else 0.0)
    return {k: (np.mean(rec[k]), np.mean(hit[k])) for k in ks}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="dev")
    ap.add_argument("--dense", nargs="*", default=["BAAI/bge-small-en-v1.5"])
    a = ap.parse_args()
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    data = load(a.split)
    res = {"bm25": evaluate(data, lambda x: bm25_scores(x["claim"], x["sents"]))}
    cache = {}
    for name in a.dense:
        D = Dense(name, dev)

        def dsc(x, D=D):
            key = (D.name, x["id"])
            if key not in cache:
                cache[key] = D.scores(x["claim"], x["sents"])
            return cache[key]

        res[name] = evaluate(data, dsc)
        res[name + "+bm25"] = evaluate(data, lambda x: rrf(dsc(x), bm25_scores(x["claim"], x["sents"])))
    print(f"{'method':55s} " + " ".join(f"R@{k:<2d}/H@{k:<2d}" for k in (1, 3, 5, 10, 20)))
    for m, r in res.items():
        print(f"{m:55s} " + " ".join(f"{r[k][0]:.2f}/{r[k][1]:.2f}  " for k in (1, 3, 5, 10, 20)))
