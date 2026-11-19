"""Precompute evidence contexts for every claim with the exact retrieval used in the browser:
BM25 + bge-small-en-v1.5 (CLS pooling, query instruction) fused by reciprocal rank fusion.
Writes ml/cache/contexts_{split}.json with ranked sentence indices (top 20).
"""
import json
from pathlib import Path

import numpy as np
import torch

from ci_data import load
from retrieval import Dense, bm25_scores, rrf

OUT = Path(__file__).parent / "cache"
OUT.mkdir(exist_ok=True)

if __name__ == "__main__":
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    D = Dense("intfloat/e5-small-v2", dev)
    for split in ["train", "dev", "test"]:
        data = load(split)
        out = []
        doc_cache = {}
        for x in data:
            key = tuple(x["sents"][:3]) + (len(x["sents"]),)
            if key not in doc_cache:
                doc_cache[key] = D.enc([D.dp + s for s in x["sents"]])
            q = D.enc([D.qp + x["claim"]])[0]
            dense = doc_cache[key] @ q
            fused = rrf(dense, bm25_scores(x["claim"], x["sents"]))
            order = np.argsort(-fused)[:20].tolist()
            out.append({"id": x["id"], "order": order, "dense_top": np.argsort(-dense)[:20].tolist()})
        json.dump(out, open(OUT / f"contexts_{split}.json", "w"))
        hit5 = np.mean([1.0 if set(o["order"][:5]) & x["gold"] else 0.0 for o, x in zip(out, data) if x["gold"]])
        print(split, len(out), f"hit@5 (claims with gold) = {hit5:.3f}")
