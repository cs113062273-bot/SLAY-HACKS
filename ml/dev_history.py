"""Why the shipped verifier scores .523/.525 in the training/export log but .485 today. Dev only, CPU, nothing overwritten.
Factors: claim text (old normalize_claim of commit af6f215, which left <|cit|> in the claim, vs current) x evidence
ranking (rebuilt with the old text vs current contexts_dev.json) x fp32 checkpoint / shipped q4 ONNX x truncation."""
import json
import os
import re
import subprocess

os.environ["CUDA_VISIBLE_DEVICES"] = ""
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from sklearn.metrics import f1_score
from transformers import AutoModelForSequenceClassification, AutoTokenizer

import ci_data
from ci_data import LABELS, load
from retrieval import Dense, bm25_scores, rrf

torch.set_num_threads(6)
src = subprocess.run(["git", "show", "af6f215:./ci_data.py"], capture_output=True, encoding="utf-8", check=True).stdout
fn = src[src.index("def normalize_claim"):]
fn = fn[:fn.index("\n\n\n")]
old = {"re": re}
exec(fn, old)  # our own earlier function
new_fn = ci_data.normalize_claim
D = {"new": load("dev", "legacy")}
ci_data.normalize_claim = old["normalize_claim"]
D["old"] = load("dev", "legacy")
ci_data.normalize_claim = new_fn
assert [x["id"] for x in D["old"]] == [x["id"] for x in D["new"]]
y = np.array([LABELS.index(x["label"]) for x in D["new"]])


def tag(S):
    return {t: sum(t in x["claim"] for x in S) for t in ("<|cit|>", "<|other_cit|>", "<|multi_cit|>")}


print("n", len(y), "counts", np.bincount(y).tolist(), "claims that differ", sum(a["claim"] != b["claim"] for a, b in zip(D["old"], D["new"])))
print("marker leftovers in claims: old", tag(D["old"]), "new", tag(D["new"]), flush=True)


def contexts(S):
    E = Dense("intfloat/e5-small-v2", "cpu")
    cache, out = {}, {}
    for x in S:
        key = tuple(x["sents"][:3]) + (len(x["sents"]),)
        if key not in cache:
            cache[key] = E.enc([E.dp + s for s in x["sents"]])
        fused = rrf(cache[key] @ E.enc([E.qp + x["claim"]])[0], bm25_scores(x["claim"], x["sents"]))
        out[x["id"]] = np.argsort(-fused)[:20].tolist()
    return out


C = {"new": {c["id"]: c["order"] for c in json.load(open("cache/contexts_dev.json"))}}
C["old"] = contexts(D["old"])
chk = contexts(D["new"])
print("rebuilt current top-5 identical to contexts_dev.json:", np.mean([chk[i][:5] == C["new"][i][:5] for i in chk]).round(3),
      "| old vs new top-5 set identical:", np.mean([set(C["old"][i][:5]) == set(C["new"][i][:5]) for i in chk]).round(3), flush=True)

d = Path("runs/deb_base_sf_k26/best")
tf = AutoTokenizer.from_pretrained(d)
m = AutoModelForSequenceClassification.from_pretrained(d).eval()
w = Path("../app/public/models/veracite-verifier")
tq = AutoTokenizer.from_pretrained(w)
s = ort.InferenceSession(str(w / "onnx/model_q4.onnx"), providers=["CPUExecutionProvider"])
names = {i.name for i in s.get_inputs()}


def fp32(c, e):
    with torch.no_grad():
        return m(**tf(c, e, truncation="only_second", max_length=512, return_tensors="pt")).logits[0].numpy()


def q4(c, e, tr):
    z = tq(c, e, truncation=tr, max_length=512, return_tensors="np")
    return s.run(None, {n: z[n].astype(np.int64) for n in names if n in z})[0][0]


for ct in ("old", "new"):
    for ev in ("old", "new"):
        rows = [(x["claim"], " ".join(x["sents"][i] for i in sorted(C[ev][x["id"]][:5]))) for x in D[ct]]
        r = {"fp32": [fp32(*a) for a in rows], "q4 only_second": [q4(*a, "only_second") for a in rows]}
        if ct == ev:
            r["q4 longest_first"] = [q4(*a, "longest_first") for a in rows]
        for k, v in r.items():
            p = np.array(v).argmax(1)
            print(f"claim={ct} evidence={ev} {k:17s} macro {f1_score(y, p, average='macro'):.3f} per-class {f1_score(y, p, average=None).round(3).tolist()}", flush=True)
