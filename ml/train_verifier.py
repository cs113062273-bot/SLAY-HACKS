"""Fine-tune a claim-support verifier on Citation-Integrity.

Input: claim [SEP] top-k retrieved evidence sentences (document order) -> ACCURATE / NOT_ACCURATE / NEI.
Model selection on dev macro-F1; per-class logit bias tuned on dev; test scored once.

Usage:
  python train_verifier.py --model MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli --k 5 --epochs 4 --out runs/base
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import classification_report, f1_score
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

from ci_data import LABELS, load

CACHE = Path(__file__).parent / "cache"


def build(split, k, gold_aug=0.0, seed=0, k_range=None):
    rng = random.Random(seed)
    data = load(split)
    ctx = {c["id"]: c["order"] for c in json.load(open(CACHE / f"contexts_{split}.json"))}
    rows = []
    for x in data:
        kk = rng.randint(*k_range) if k_range else k
        order = ctx[x["id"]][:kk]
        if gold_aug and x["gold"] and rng.random() < gold_aug:
            g = [i for i in x["gold"] if i not in order]
            if g:
                order = order[: k - 1] + [rng.choice(g)]
        ev = " ".join(x["sents"][i] for i in sorted(order))
        rows.append((x["claim"], ev, LABELS.index(x["label"])))
    return rows


import re as _re

_SWAPS = [
    ("increased", "decreased"), ("increase", "decrease"), ("increases", "decreases"), ("higher", "lower"), ("more", "less"),
    ("positive", "negative"), ("positively", "negatively"), ("enhanced", "reduced"), ("enhances", "reduces"), ("promotes", "inhibits"),
    ("upregulated", "downregulated"), ("up-regulated", "down-regulated"), ("improved", "worsened"), ("improves", "worsens"),
    ("larger", "smaller"), ("greater", "smaller"), ("risk factor", "protective factor"), ("activates", "suppresses"), ("before", "after"),
    ("all", "few"), ("most", "few"), ("majority", "minority"), ("strongly", "weakly"), ("significantly", "not significantly"),
]
# quantities only (not identifiers such as miR-211 or citation leftovers)
_QTY = r"(?<![\w\-.])\d+(?:\.\d+)?(?=\s*(?:%|percent|-fold|\s?fold|\s?times))"
_NEG = [(r"\b(is|are|was|were)\b", r"\1 not"), (r"\bcan\b", "cannot"), (r"\b(has|have)\b", r"\1 not"), (r"\b(may)\b", r"\1 not")]


def perturb_claim(claim, rng):
    """Turn a supported claim into a misrepresentation of the same evidence (direction, negation or number)."""
    ops = []
    for a, b in _SWAPS:
        for x, z in ((a, b), (b, a)):
            if _re.search(rf"\b{_re.escape(x)}\b", claim, _re.I):
                ops.append(("swap", x, z))
    if _re.search(_QTY, claim):
        ops.append(("num",))
    for pat, rep in _NEG:
        if _re.search(pat, claim) and " not " not in claim:
            ops.append(("neg", pat, rep))
    if not ops:
        return None
    op = rng.choice(ops)
    if op[0] == "swap":
        return _re.sub(rf"\b{_re.escape(op[1])}\b", op[2], claim, count=1, flags=_re.I)
    if op[0] == "num":
        def bump(m):
            v = float(m.group(0))
            nv = v * rng.choice([2, 3, 0.5, 0.25]) if v != 0 else 5
            return str(int(nv)) if float(nv).is_integer() else f"{nv:.1f}"
        return _re.sub(_QTY, bump, claim, count=1)
    return _re.sub(op[1], op[2], claim, count=1)


def build_perturbed(seed=0, k_range=(2, 6), ratio=1.0):
    """Synthetic NOT_ACCURATE: perturbed ACCURATE claims paired with their own gold evidence (+ retrieved context)."""
    rng = random.Random(seed + 7)
    data = load("train")
    ctx = {c["id"]: c["order"] for c in json.load(open(CACHE / "contexts_train.json"))}
    rows = []
    for x in data:
        if x["label"] != "ACCURATE" or not x["gold"] or rng.random() > ratio:
            continue
        pc = perturb_claim(x["claim"], rng)
        if not pc or pc == x["claim"]:
            continue
        kk = rng.randint(*k_range)
        order = list(dict.fromkeys(sorted(x["gold"])[:2] + ctx[x["id"]]))[:kk]
        rows.append((pc, " ".join(x["sents"][i] for i in sorted(order)), LABELS.index("NOT_ACCURATE")))
    return rows


def build_mnli(n=12000, seed=0):
    """NLI replay to keep the base model's contradiction skill: entail→ACC, contradiction→NOT_ACC, neutral→NEI."""
    import pandas as pd

    path = Path(__file__).resolve().parent.parent / "data" / "mnli" / "train.parquet"
    df = pd.read_parquet(path).sample(n=n, random_state=seed)
    m = {0: 0, 2: 1, 1: 2}  # MNLI: 0 entailment, 1 neutral, 2 contradiction
    return [(h, p, m[int(l)]) for p, h, l in zip(df["premise"], df["hypothesis"], df["label"]) if int(l) in m]


def build_scifact(seed=0, nei_ratio=0.3):
    """SciFact train as auxiliary data. SUPPORT→ACCURATE, CONTRADICT→NOT_ACCURATE,
    cited-but-no-rationale→NOT_ACCURATE (related but unsupporting), random abstract→NEI."""
    rng = random.Random(seed)
    root = Path(__file__).resolve().parent.parent / "data" / "scifact" / "data"
    corpus = {}
    for line in open(root / "corpus.jsonl", encoding="utf-8"):
        d = json.loads(line)
        corpus[d["doc_id"]] = d
    ids = list(corpus)
    rows = []
    for line in open(root / "claims_train.jsonl", encoding="utf-8"):
        c = json.loads(line)
        for did in c.get("cited_doc_ids", []):
            doc = corpus.get(did)
            if not doc:
                continue
            ev = c["evidence"].get(str(did))
            sents = doc["abstract"]
            if ev and rng.random() < 0.5:
                # rationale sentences plus a few neighbours (evidence-count robustness)
                keep = sorted({i for e in ev for i in e["sentences"]} | set(rng.sample(range(len(sents)), min(len(sents), rng.randint(0, 3)))))
                text = " ".join(sents[i] for i in keep if i < len(sents))
            else:
                text = doc["title"] + ". " + " ".join(sents)
            if ev:
                lab = "ACCURATE" if ev[0]["label"] == "SUPPORT" else "NOT_ACCURATE"
            else:
                lab = "NOT_ACCURATE"
            rows.append((c["claim"], text, LABELS.index(lab)))
        if rng.random() < nei_ratio:
            doc = corpus[rng.choice(ids)]
            rows.append((c["claim"], doc["title"] + ". " + " ".join(doc["abstract"]), LABELS.index("NEI")))
    return rows


class DS(Dataset):
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        return self.rows[i]


def collate(tok, max_len):
    def f(batch):
        c, e, y = zip(*batch)
        enc = tok(list(c), list(e), truncation="only_second", max_length=max_len, padding=True, return_tensors="pt")
        enc["labels"] = torch.tensor(y)
        return enc

    return f


@torch.no_grad()
def predict(model, loader, device):
    model.eval()
    out = []
    for b in loader:
        b = {k: v.to(device) for k, v in b.items() if k != "labels"}
        with torch.autocast("cuda", dtype=torch.float16, enabled=device == "cuda"):
            out.append(model(**b).logits.float().cpu())
    return torch.cat(out).numpy()


def tune_bias(logits, y):
    """Grid-search additive biases for NOT_ACCURATE and NEI that maximize macro-F1."""
    best = (f1_score(y, logits.argmax(1), average="macro"), (0.0, 0.0))
    for b1 in np.arange(-2, 3.01, 0.25):
        for b2 in np.arange(-2, 3.01, 0.25):
            p = (logits + np.array([0, b1, b2])).argmax(1)
            f = f1_score(y, p, average="macro")
            if f > best[0] + 1e-9:
                best = (f, (float(b1), float(b2)))
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--bs", type=int, default=8)
    ap.add_argument("--accum", type=int, default=2)
    ap.add_argument("--max_len", type=int, default=512)
    ap.add_argument("--gold_aug", type=float, default=0.0)
    ap.add_argument("--class_weight", type=float, default=1.0, help="exponent for inverse-frequency weights")
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--scifact", action="store_true", help="add SciFact train as auxiliary data")
    ap.add_argument("--semcite", action="store_true", help="add SemanticCite (train split) as cross-domain data")
    ap.add_argument("--perturb", type=float, default=0.0, help="fraction of ACCURATE train claims to turn into synthetic misrepresentations")
    ap.add_argument("--mnli", type=int, default=0, help="number of MNLI pairs for NLI replay")
    ap.add_argument("--k_range", default=None, help="random evidence count per training example, e.g. 1-7")
    ap.add_argument("--out", required=True)
    ap.add_argument("--grad_ckpt", action="store_true", help="gradient checkpointing (lower GPU memory)")
    ap.add_argument("--test", action="store_true", help="also evaluate on test (do this once, at the end)")
    a = ap.parse_args()
    torch.manual_seed(a.seed)
    random.seed(a.seed)
    np.random.seed(a.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    tok = AutoTokenizer.from_pretrained(a.model)
    model = AutoModelForSequenceClassification.from_pretrained(a.model, num_labels=3, ignore_mismatched_sizes=True, id2label=dict(enumerate(LABELS)), label2id={l: i for i, l in enumerate(LABELS)}).to(device)
    if a.grad_ckpt:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    if hasattr(model, "gradient_checkpointing_enable") and "large" in a.model.lower():
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})

    kr = tuple(int(v) for v in a.k_range.split("-")) if a.k_range else None
    tr = build("train", a.k, a.gold_aug, a.seed, kr)
    if a.perturb:
        pr = build_perturbed(a.seed, kr or (2, 6), a.perturb)
        print("perturbed rows", len(pr), flush=True)
        tr = tr + pr
    if a.mnli:
        mn = build_mnli(a.mnli, a.seed)
        print("mnli rows", len(mn), flush=True)
        tr = tr + mn
    if a.semcite:
        from semcite import train_rows

        sc = train_rows()
        print("semanticcite rows", len(sc), flush=True)
        tr = tr + sc
    if a.scifact:
        sf = build_scifact(a.seed)
        print("scifact rows", len(sf), flush=True)
        tr = tr + sf
    dv = build("dev", a.k)
    col = collate(tok, a.max_len)
    tl = DataLoader(DS(tr), batch_size=a.bs, shuffle=True, collate_fn=col)
    dl = DataLoader(DS(dv), batch_size=16, collate_fn=col)
    y_tr = np.array([r[2] for r in tr])
    freq = np.bincount(y_tr, minlength=3) / len(y_tr)
    w = torch.tensor((1 / freq) ** a.class_weight, dtype=torch.float)
    w = (w / w.mean()).to(device)
    lossf = torch.nn.CrossEntropyLoss(weight=w)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01)
    steps = len(tl) * a.epochs // a.accum
    sch = get_linear_schedule_with_warmup(opt, int(0.06 * steps), steps)
    scaler = torch.amp.GradScaler(enabled=device == "cuda")
    y_dv = np.array([r[2] for r in dv])
    best = -1
    log = []
    for ep in range(a.epochs):
        model.train()
        tot = 0
        for i, b in enumerate(tl):
            b = {k: v.to(device) for k, v in b.items()}
            y = b.pop("labels")
            with torch.autocast("cuda", dtype=torch.bfloat16 if "deberta" in a.model.lower() else torch.float16, enabled=device == "cuda"):
                loss = lossf(model(**b).logits.float(), y) / a.accum
            scaler.scale(loss).backward()
            tot += loss.item()
            if (i + 1) % a.accum == 0:
                scaler.unscale_(opt)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(opt)
                scaler.update()
                opt.zero_grad()
                sch.step()
        lg = predict(model, dl, device)
        f = f1_score(y_dv, lg.argmax(1), average="macro")
        fb, bias = tune_bias(lg, y_dv)
        log.append({"epoch": ep + 1, "loss": tot / len(tl), "dev_macro": f, "dev_macro_biased": fb, "bias": bias})
        print(json.dumps(log[-1]), flush=True)
        if f > best:
            best = f
            model.save_pretrained(out / "best")
            tok.save_pretrained(out / "best")
            json.dump({"bias": bias, "dev_macro": f, "dev_macro_biased": fb, "args": vars(a)}, open(out / "best" / "veracite.json", "w"), indent=1)
    json.dump(log, open(out / "log.json", "w"), indent=1)
    if a.test:
        model = AutoModelForSequenceClassification.from_pretrained(out / "best").to(device)
        meta = json.load(open(out / "best" / "veracite.json"))
        te = build("test", a.k)
        lg = predict(model, DataLoader(DS(te), batch_size=16, collate_fn=col), device)
        y = np.array([r[2] for r in te])
        for name, p in [("raw", lg.argmax(1)), ("biased", (lg + np.array([0, *meta["bias"]])).argmax(1))]:
            print(f"TEST {name}: micro-F1={f1_score(y, p, average='micro'):.3f} macro-F1={f1_score(y, p, average='macro'):.3f}")
            print(classification_report(y, p, target_names=LABELS, digits=3))
        np.save(out / "test_logits.npy", lg)


if __name__ == "__main__":
    main()
