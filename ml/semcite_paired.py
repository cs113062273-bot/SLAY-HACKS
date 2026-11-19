"""Paired bootstrap of SemanticCite AUROC difference between two checkpoints (same held-out 30%)."""
import sys, numpy as np
from sklearn.metrics import roc_auc_score
from semcite import load, evidence_text, support_scores
te = [e for e in load("test") if e["output"]["classification"] in ("SUPPORTED", "UNSUPPORTED")]
pairs = [(e["input"]["claim"], evidence_text(e)) for e in te]
y = np.array([1 if e["output"]["classification"] == "SUPPORTED" else 0 for e in te])
a, b = support_scores(sys.argv[1], pairs), support_scores(sys.argv[2], pairs)
rng = np.random.default_rng(0); d = []
for _ in range(5000):
    i = rng.integers(0, len(y), len(y))
    if y[i].min() == y[i].max(): continue
    d.append(roc_auc_score(y[i], b[i]) - roc_auc_score(y[i], a[i]))
d = np.array(d)
print(f"A={roc_auc_score(y,a):.3f} B={roc_auc_score(y,b):.3f} diff={np.mean(d):+.3f} 95%CI [{np.percentile(d,2.5):+.3f}, {np.percentile(d,97.5):+.3f}] P(B<A)={np.mean(d<0):.2f}")
