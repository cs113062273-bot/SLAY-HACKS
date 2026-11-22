"""Reproduce the released Citation-Integrity MultiVerS model (Sarol et al. 2024; Longformer-large, fine-tuned from the
HealthVer MultiVerS checkpoint) on the authors' released inputs (scifact_10: citance + top-5 BM25/MonoT5 sentences),
scored with the same metrics as our verifier. Also runs it on our own retrieval (--ours) for a like-for-like comparison.
Weights: ext/multivers_ci/multivers_ci_sd.pt (state_dict extracted with ext/safe_ckpt.py, no pickled code executed).
Usage: python multivers_eval.py --split dev|test [--ours]
"""
import argparse, json, time
from pathlib import Path
import numpy as np, torch, torch.nn as nn
from sklearn.metrics import f1_score, roc_auc_score
from transformers import AutoConfig, AutoTokenizer, LongformerModel

R = Path("ext/multivers_ci/MultiverS_model/scifact_10")
ADD = ["<|sec|>", "</|sec|>", "<|sec-title|>", "</|sec-title|>", "<|abs|>", "</|abs|>", "<|title|>", "</|title|>", "<|sent|>", "<|par|>", "<|cit|>", "<|multi_cit|>", "<|other_cit|>"]
LK = {"NOT_ACCURATE": 0, "NEI": 1, "ACCURATE": 2}  # MultiVerS label ids


class MV(nn.Module):
    def __init__(self):
        super().__init__()
        cfg = AutoConfig.from_pretrained("allenai/longformer-large-4096"); cfg.vocab_size = 50278
        self.encoder = LongformerModel(cfg)
        self.label_classifier = nn.Sequential(nn.Linear(1024, 1024), nn.GELU(), nn.Linear(1024, 3))

    def forward(self, **enc):
        return self.label_classifier(self.encoder(**enc).pooler_output)


def load_model():
    sd = torch.load("ext/multivers_ci/multivers_ci_sd.pt", map_location="cpu", weights_only=True)
    m = MV()
    new = {k: v.float() for k, v in sd.items() if k.startswith("encoder.")}
    new.update({k.replace("_linear_layers.0", "0").replace("_linear_layers.1", "2"): v.float() for k, v in sd.items() if k.startswith("label_classifier.")})
    missing, unexpected = m.load_state_dict(new, strict=False)
    print("missing", [k for k in missing if "position_ids" not in k], "unexpected", unexpected[:5])
    return m.half().cuda().eval()


def encode(tok, claim, sents):
    # data.py tests `title is not None`: the released corpus has title "" so an empty title still adds one separator
    ids = tok(claim + tok.eos_token + tok.eos_token + tok.eos_token.join(sents), truncation=True, max_length=4096)["input_ids"]
    ids = torch.tensor(ids)
    first = torch.where(ids == tok.eos_token_id)[0][0]
    g = (ids == tok.bos_token_id) | (ids == tok.eos_token_id); g[: first] = True
    return ids, g.long()


def inputs(split, ours):
    if not ours:
        C = {d["doc_id"]: d for d in map(json.loads, open(R / "corpus.jsonl", encoding="utf-8"))}
        out = []
        for x in map(json.loads, open(R / f"claims_{split}.jsonl", encoding="utf-8")):
            labs = {e["label"] for v in x["evidence"].values() for e in v}
            out.append((x["claim"], C[x["cited_doc_ids"][0]]["abstract"], labs.pop() if labs else "NEI"))
        return out
    from ci_data import load
    ctx = {c["id"]: c["order"] for c in json.load(open(f"cache/contexts_{split}.json"))}
    return [(x["raw_claim"].replace("<|other_cit|>", "<|other_cit|>"), [x["sents"][i] for i in sorted(ctx[x["id"]][:5])], x["label"]) for x in load(split, "paper")]


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--split", default="dev", choices=["dev"]); ap.add_argument("--ours", action="store_true"); a = ap.parse_args()
    tok = AutoTokenizer.from_pretrained("allenai/longformer-large-4096"); tok.add_tokens(ADD)
    m = load_model(); data = inputs(a.split, a.ours)
    P = []; t0 = time.time()
    with torch.no_grad():
        for c, s, _ in data:
            ids, g = encode(tok, c, s)
            P.append(torch.softmax(m(input_ids=ids[None].cuda(), attention_mask=torch.ones_like(ids)[None].cuda(), global_attention_mask=g[None].cuda()).float(), -1)[0].cpu().numpy())
    P = np.array(P)[:, [2, 0, 1]]  # -> ACCURATE, NOT_ACCURATE, NEI (our order)
    y = np.array([["ACCURATE", "NOT_ACCURATE", "NEI"].index(l) for *_, l in data]); p = P.argmax(1)
    tag = f"{a.split}{'-ours' if a.ours else ''}"
    np.save(f"cache/multivers_{tag}.npy", P)
    print(f"MultiVerS-CI {tag} n={len(y)} counts={np.bincount(y,minlength=3).tolist()} micro {f1_score(y,p,average='micro'):.3f} macro {f1_score(y,p,average='macro'):.3f} per-class ACC/NOT/NEI {f1_score(y,p,average=None,labels=[0,1,2]).round(3).tolist()}  binary AUROC {roc_auc_score(y==0,P[:,0]):.3f}  {1000*(time.time()-t0)/len(y):.0f} ms/claim (GPU fp16)")
