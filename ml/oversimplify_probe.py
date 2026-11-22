"""Zero-shot probes for misrepresentation types the verifier misses (OVERSIMPLIFY above all), on CI train+dev under the
paper mapping (the probe models never saw Citation-Integrity, so train is unseen data for them; test is not used).
  strength: causal claim strength (copenlu/scientific-exaggeration-detection, Wright & Augenstein EMNLP 2021; 4 ordinal
            classes none/correlational/conditional causal/direct causal), expected value. Feature = claim strength minus
            strength of the best-matching evidence sentence (an overstated claim is stronger than its source).
  spiced:   information-matching similarity (copenlu/spiced, Wright et al. EMNLP 2022), max over evidence sentences.
Evidence = the top-5 sentences our retrieval gives the verifier. Output: AUROC per contrast; shipped-model AUROC on dev
for reference. Runs on CPU."""
import json
import numpy as np, torch
from sklearn.metrics import roc_auc_score
from transformers import AutoModel, AutoModelForSequenceClassification, AutoTokenizer
from ci_data import LABELS, load

torch.set_num_threads(8)
rows = []
for sp in ["train", "dev"]:
    ctx = {c["id"]: c["order"] for c in json.load(open(f"cache/contexts_{sp}.json"))}
    for x in load(sp, "paper"):
        rows.append((sp, x["label"], x["fine"], x["claim"], [x["sents"][i] for i in sorted(ctx[x["id"]][:5])]))
sents = sorted({s for r in rows for s in [r[3], *r[4]]}); ix = {s: i for i, s in enumerate(sents)}
print("rows", len(rows), "unique sentences", len(sents), flush=True)

@torch.no_grad()
def run(fn, bs=64):
    out = []
    for i in range(0, len(sents), bs):
        out.append(fn(sents[i : i + bs]))
        if i % 3200 == 0: print(i, flush=True)
    return np.concatenate(out)

tk = AutoTokenizer.from_pretrained("copenlu/scientific-exaggeration-detection"); m = AutoModelForSequenceClassification.from_pretrained("copenlu/scientific-exaggeration-detection").eval()
S = run(lambda b: (torch.softmax(m(**tk(b, truncation=True, max_length=128, padding=True, return_tensors="pt")).logits, -1) @ torch.arange(4.0)).numpy())
tk = AutoTokenizer.from_pretrained("copenlu/spiced"); e = AutoModel.from_pretrained("copenlu/spiced").eval()
def emb(b):
    enc = tk(b, truncation=True, max_length=128, padding=True, return_tensors="pt"); h = e(**enc).last_hidden_state
    v = (h * enc["attention_mask"][..., None]).sum(1) / enc["attention_mask"].sum(1, keepdim=True)
    return torch.nn.functional.normalize(v, dim=-1).numpy()
E = run(emb)
np.savez("cache/probe_feats.npz", S=S, E=E, sents=np.array(sents, dtype=object))
F = {"strength_gap": [], "claim_strength": [], "spiced_max": []}
for sp, lab, fine, c, ev in rows:
    ci, ei = ix[c], [ix[s] for s in ev] or [ix[c]]
    sim = E[ei] @ E[ci]; best = ei[int(sim.argmax())]
    F["strength_gap"].append(S[ci] - S[best]); F["claim_strength"].append(S[ci]); F["spiced_max"].append(sim.max())
F = {k: np.array(v) for k, v in F.items()}
lab = np.array([r[1] for r in rows]); fine = np.array([r[2] for r in rows]); spl = np.array([r[0] for r in rows])
contrasts = {"OVERSIMPLIFY vs ACCURATE": (fine == "OVERSIMPLIFY", lab == "ACCURATE"), "NOT_ACC vs ACC": (lab == "NOT_ACCURATE", lab == "ACCURATE"),
             "not-supported vs ACC": (lab != "ACCURATE", lab == "ACCURATE"), "CONTRADICT vs ACCURATE": (fine == "CONTRADICT", lab == "ACCURATE"),
             "NOT_SUBST vs ACCURATE": (fine == "NOT_SUBSTANTIATE", lab == "ACCURATE"), "ETIQUETTE vs ACCURATE": (fine == "ETIQUETTE", lab == "ACCURATE")}
sign = {"strength_gap": 1, "claim_strength": 1, "spiced_max": -1}
L = np.load("cache/dev_logits_shipped.npy"); pa = np.exp(L - L.max(1, keepdims=True)); pa = pa[:, 0] / pa.sum(1)
for name, (pos, neg) in contrasts.items():
    sel = pos | neg; s = f"{name:26s} n+={pos.sum():4d}"
    for k, v in F.items(): s += f"  {k} {roc_auc_score(pos[sel], sign[k]*v[sel]):.3f}"
    d = spl == "dev"; dp, dn = pos[d], neg[d]
    if dp.sum() >= 5: s += f"  | dev: shipped {roc_auc_score(dp[dp|dn], -pa[(dp|dn)]):.3f} spiced {roc_auc_score(dp[dp|dn], -F['spiced_max'][d][dp|dn]):.3f} gap {roc_auc_score(dp[dp|dn], F['strength_gap'][d][dp|dn]):.3f} (n+={dp.sum()})"
    print(s)
