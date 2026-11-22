"""Paired comparison of two stress-set runs (data/stress/results-<a>.json vs results-<b>.json).
Prints per-type flag rates side by side, and every item whose flagged/not-flagged outcome changed.
Usage: python -I app/scripts/stress-compare.py base-ad06636 systemic1
"""
import json
sys_ = __import__("sys"); sys_.stdout.reconfigure(encoding="utf-8")
import sys
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parents[2] / "data" / "stress"
FLAG = {"metadata_error", "id_mismatch", "fabricated", "not_found", "retracted"}
a, b = sys.argv[1], sys.argv[2]
A = {x["id"]: x for x in json.loads((root / f"results-{a}.json").read_text("utf-8"))["items"]}
B = {x["id"]: x for x in json.loads((root / f"results-{b}.json").read_text("utf-8"))["items"]}
items = json.loads((root / "stress-set.json").read_text("utf-8"))["items"]
raw = {x["id"]: x for x in items}
ids = [i for i in A if i in B]
by = defaultdict(lambda: [0, 0, 0])
for i in ids:
    t = A[i]["type"]
    by[t][0] += 1
    by[t][1] += A[i]["verdict"] in FLAG
    by[t][2] += B[i]["verdict"] in FLAG
print(f"{'type':18s} {'n':>4s}  {a:>14s}  {b:>14s}")
for t in sorted(by):
    n, x, y = by[t]
    print(f"{t:18s} {n:4d}  {x/n:14.3f}  {y/n:14.3f}")
P = [i for i in ids if A[i]["truth"] == "error"]
N = [i for i in ids if A[i]["truth"] == "correct"]
for name, R in ((a, A), (b, B)):
    tp = sum(R[i]["verdict"] in FLAG for i in P)
    fp = sum(R[i]["verdict"] in FLAG for i in N)
    p, r = tp / max(1, tp + fp), tp / max(1, len(P))
    print(f"{name}: P {p:.3f} R {r:.3f} F1 {2*p*r/max(1e-9,p+r):.3f}  FP {fp}/{len(N)}  abstain-on-errors {sum(R[i]['verdict'] in ('unchecked','unverifiable') for i in P)}")
print("\nChanged outcomes:")
for i in ids:
    fa, fb = A[i]["verdict"] in FLAG, B[i]["verdict"] in FLAG
    if fa != fb:
        good = fb if A[i]["truth"] == "error" else not fb
        print(f"  {'+' if good else '-'} [{A[i]['type']}] {A[i]['verdict']} -> {B[i]['verdict']} (unrecorded {B[i].get('unrecorded', 0)})  {raw[i].get('note') or ''}  {raw[i]['raw'][:120]}")
