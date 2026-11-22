"""Zero-shot grounding checkers on Citation-Integrity DEV (never test): can an off-the-shelf fact-checker separate
NOT_ACCURATE from ACCURATE better than the shipped verifier (AUROC .58 NOT_ACC vs rest)?

Models: MiniCheck RoBERTa-L / DeBERTa-v3-L / Flan-T5-L (Tang et al., EMNLP 2024; input "doc</s>claim", chunk-and-max)
and a DeBERTa-v3-large NLI model (as in BibAgent's verifier). Evidence: retrieved top-5 (what the app uses), gold
sentences (oracle), top-20 retrieved sentences chunked (chunk-and-max). Also 5-fold CV logistic regression stacking the
shipped verifier's probabilities with each support score, against the same CV on the shipped probabilities alone.
Usage: python zeroshot.py [model ...]
"""
import json
import sys
from pathlib import Path

import numpy as np
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from transformers import AutoModelForSeq2SeqLM, AutoModelForSequenceClassification, AutoTokenizer

from ci_data import LABELS, load

CACHE = Path(__file__).parent / "cache"
MODELS = {
    "mc-roberta": "lytang/MiniCheck-RoBERTa-Large",
    "mc-deberta": "lytang/MiniCheck-DeBERTa-v3-Large",
    "mc-t5": "lytang/MiniCheck-Flan-T5-Large",
    "nli-deberta": "MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli",
}


class Scorer:
    def __init__(self, name):
        self.name, ckpt = name, MODELS[name]
        self.tok = AutoTokenizer.from_pretrained(ckpt)
        if name == "mc-t5":
            self.model = AutoModelForSeq2SeqLM.from_pretrained(ckpt, torch_dtype=torch.bfloat16).cuda().eval()
        else:
            self.model = AutoModelForSequenceClassification.from_pretrained(ckpt).cuda().eval()
        self.max_len = 512 if name in ("mc-roberta", "nli-deberta") else 1024

    @torch.no_grad()
    def support(self, pairs, bs=8):
        """pairs: (doc, claim) -> P(supported)"""
        out = []
        for i in range(0, len(pairs), bs):
            b = pairs[i : i + bs]
            if self.name == "nli-deberta":
                enc = self.tok([d for d, _ in b], [c for _, c in b], truncation="only_first", max_length=self.max_len, padding=True, return_tensors="pt").to("cuda")
                p = torch.softmax(self.model(**enc).logits.float(), -1)
                ent = self.model.config.label2id.get("entailment", 0)
                out.append(p[:, ent].cpu().numpy())
                continue
            texts = [d + self.tok.eos_token + c for d, c in b]
            if self.name == "mc-t5":
                enc = self.tok(["predict: " + t for t in texts], truncation=True, max_length=self.max_len, padding=True, return_tensors="pt").to("cuda")
                dec = torch.zeros((len(b), 1), dtype=torch.long, device="cuda")
                logits = self.model(**enc, decoder_input_ids=dec).logits[:, 0, :].float()
                out.append(torch.softmax(logits[:, torch.tensor([3, 209])], -1)[:, 1].cpu().numpy())
            else:
                enc = self.tok(texts, truncation=True, max_length=self.max_len, padding=True, return_tensors="pt").to("cuda")
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    out.append(torch.softmax(self.model(**enc).logits.float(), -1)[:, 1].cpu().numpy())
        return np.concatenate(out)


def chunks(sents, tok, size):
    cur, n, res = [], 0, []
    for s in sents:
        k = len(tok(s, add_special_tokens=False)["input_ids"])
        if cur and n + k > size:
            res.append(" ".join(cur)); cur, n = [], 0
        cur.append(s); n += k
    if cur: res.append(" ".join(cur))
    return res or [""]


def main():
    names = sys.argv[1:] or ["mc-roberta", "nli-deberta", "mc-deberta", "mc-t5"]
    data = load("dev")
    ship = np.load(CACHE / "dev_probs_verifier_backup_sf_k26.npy")
    assert len(ship) == len(data), (len(ship), len(data))
    ctx = {c["id"]: c["order"] for c in json.load(open(CACHE / "contexts_dev.json"))}
    y = np.array([LABELS.index(x["label"]) for x in data])
    an = (y == 0) | (y == 1)
    claims = [x["claim"] for x in data]
    retr = [" ".join(x["sents"][i] for i in sorted(ctx[x["id"]][:5])) for x in data]
    gold = [" ".join(x["sents"][i] for i in sorted(x["gold"])) if x["gold"] else r for x, r in zip(data, retr)]
    print(f"dev n={len(y)} ACC {sum(y==0)} NOT {sum(y==1)} NEI {sum(y==2)}")
    print(f"shipped: AUROC ACC-vs-NOT {roc_auc_score(y[an]==0, ship[an,0]):.3f}  NOT-vs-rest {roc_auc_score(y==1, ship[:,1]):.3f}  macro-F1 {f1_score(y, ship.argmax(1), average='macro'):.3f}")
    cv = StratifiedKFold(5, shuffle=True, random_state=0)
    lg = lambda X: cross_val_predict(LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0), X, y, cv=cv, method="predict_proba")
    L = np.log(ship + 1e-6)
    base = lg(L)
    print(f"  CV-LR on shipped probs alone: macro-F1 {f1_score(y, base.argmax(1), average='macro'):.3f} per-class {f1_score(y, base.argmax(1), average=None).round(3).tolist()}")
    res = {}
    for name in names:
        sc = Scorer(name)
        r = sc.support(list(zip(retr, claims)))
        g = sc.support(list(zip(gold, claims)))
        size = (sc.max_len - 100)
        full = []
        for x, c in zip(data, claims):
            # top-20 retrieved sentences in document order, chunked (the whole paper is ~5k words: too slow for 4 models)
            ch = chunks([x["sents"][i] for i in sorted(ctx[x["id"]][:20])], sc.tok, size)
            full.append(sc.support([(d, c) for d in ch]).max())
        full = np.array(full)
        res[name] = dict(retr=r.tolist(), gold=g.tolist(), full=full.tolist())
        for lab, s in (("retrieved", r), ("gold", g), ("top20-chunked", full)):
            print(f"{name:12s} {lab:13s} AUROC ACC-vs-NOT {roc_auc_score(y[an]==0, s[an]):.3f}  ACC-vs-rest {roc_auc_score(y==0, s):.3f}  NOT-vs-rest {roc_auc_score(y==1, -s):.3f}")
        X = np.column_stack([L, np.log(np.column_stack([r, full]) + 1e-6)])
        st = lg(X)
        print(f"  CV-LR shipped + {name}: macro-F1 {f1_score(y, st.argmax(1), average='macro'):.3f} per-class {f1_score(y, st.argmax(1), average=None).round(3).tolist()}")
        del sc; torch.cuda.empty_cache()
    json.dump(res, open(CACHE / "zeroshot_dev.json", "w"))


if __name__ == "__main__":
    main()
