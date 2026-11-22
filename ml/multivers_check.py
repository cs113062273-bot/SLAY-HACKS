"""MultiVerS-CI checks, CPU, no CI test.
(1) token ids / global attention from our encode() vs the authors' own tokenisation methods (data_train.py, compiled from
    source) on all released dev inputs;
(2) SemanticCite held-out 30%, which neither that checkpoint nor our shipped model was trained on: same pairs for both;
(3) fp32 dev scores, NOT a performance number: the checkpoint records num_training_instances 2454 = 2138 train + 316 dev."""
import ast
import os

os.environ["CUDA_VISIBLE_DEVICES"] = ""
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from sklearn.metrics import f1_score, roc_auc_score
from transformers import AutoTokenizer

import multivers_eval as M
import semcite

torch.set_num_threads(6)
src = open("../data/Citation-Integrity/CitationAccuracyClassificationCode/multivers/data_train.py", encoding="utf-8").read()
cls = [c for c in ast.parse(src).body if isinstance(c, ast.ClassDef) and c.name == "SciFactDataset"][0]
want = ("_tokenize_longformer", "_get_global_attention_mask", "_get_abstract_sent_tokens", "_get_claim_sent_tokens")
holder = ast.parse("class A:\n    pass")
holder.body[0].body = [f for f in cls.body if isinstance(f, ast.FunctionDef) and f.name in want]
ns = {"torch": torch, "np": np}
exec(compile(holder, "authors", "exec"), ns)
tok = AutoTokenizer.from_pretrained("allenai/longformer-large-4096")
tok.add_tokens(M.ADD)
A = ns["A"]()
A.tokenizer = tok
data = M.inputs("dev", False)
same = 0
for c, sents, _ in data:
    t = A._tokenize_longformer(c, sents, "")[0]
    ids, g = M.encode(tok, c, sents)
    same += t["input_ids"] == ids.tolist() and t["global_attention_mask"] == g.tolist()
print(f"token ids + global attention identical to the authors' code: {same}/{len(data)}", flush=True)

sd = torch.load("ext/multivers_ci/multivers_ci_sd.pt", map_location="cpu", weights_only=True)
m = M.MV()
new = {k: v.float() for k, v in sd.items() if k.startswith("encoder.")}
new.update({k.replace("_linear_layers.0", "0").replace("_linear_layers.1", "2"): v.float() for k, v in sd.items() if k.startswith("label_classifier.")})
print("load_state_dict", m.load_state_dict(new, strict=False), flush=True)
m.float().eval()


def prob(c, sents):
    ids, g = M.encode(tok, c, sents)
    with torch.no_grad():
        return torch.softmax(m(input_ids=ids[None], attention_mask=torch.ones_like(ids)[None], global_attention_mask=g[None]), -1)[0].numpy()[[2, 0, 1]]


te = [e for e in semcite.load("test") if e["output"]["classification"] in ("SUPPORTED", "UNSUPPORTED")]
y = np.array([e["output"]["classification"] == "SUPPORTED" for e in te])


def snips(e):
    return [" ".join(x["text"].split()) for x in sorted(e["input"]["ref_snippets"], key=lambda x: -x.get("relevance_score", 0))[:5]]


P = np.array([prob(e["input"]["claim"], snips(e)) for e in te])
np.save("cache/semcite_multivers.npy", P)
w = Path("../app/public/models/veracite-verifier")
tq = AutoTokenizer.from_pretrained(w)
s = ort.InferenceSession(str(w / "onnx/model_q4.onnx"), providers=["CPUExecutionProvider"])
names = {i.name for i in s.get_inputs()}
Q = []
for e in te:
    z = tq(e["input"]["claim"], semcite.evidence_text(e), truncation="only_second", max_length=512, return_tensors="np")
    v = s.run(None, {k: z[k].astype(np.int64) for k in names if k in z})[0][0]
    v = np.exp(v - v.max())
    Q.append(v / v.sum())
Q = np.array(Q)
rng = np.random.default_rng(0)
B = [b for b in (rng.integers(0, len(y), len(y)) for _ in range(2000)) if 0 < y[b].sum() < len(b)]
dd = [roc_auc_score(y[b], Q[b, 0]) - roc_auc_score(y[b], P[b, 0]) for b in B]
print(f"SemanticCite n={len(y)}: MultiVerS AUROC {roc_auc_score(y, P[:, 0]):.3f}  shipped q4 {roc_auc_score(y, Q[:, 0]):.3f}  diff {np.mean(dd):+.3f} [{np.percentile(dd, 2.5):+.3f}, {np.percentile(dd, 97.5):+.3f}]", flush=True)
Pd = np.array([prob(c, sents) for c, sents, _ in data])
yd = np.array([["ACCURATE", "NOT_ACCURATE", "NEI"].index(lab) for *_, lab in data])
print(f"released dev inputs (likely training data for this checkpoint): macro {f1_score(yd, Pd.argmax(1), average='macro'):.3f} per-class {f1_score(yd, Pd.argmax(1), average=None).round(3).tolist()}", flush=True)
