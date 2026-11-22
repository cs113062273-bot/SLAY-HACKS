"""Citation-Integrity (Sarol et al., 2024) loader.

Label mapping follows the paper: ACCURATE + INDIRECT -> ACCURATE;
CONTRADICT, NOT_SUBSTANTIATE, OVERSIMPLIFY, MISQUOTE, ETIQUETTE -> NOT_ACCURATE;
IRRELEVANT / no evidence -> NEI.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "data" / "Citation-Integrity" / "Data" / "multivers-format"
LABELS = ["ACCURATE", "NOT_ACCURATE", "NEI"]
FINE_TO_3 = {
    "ACCURATE": "ACCURATE",
    "INDIRECT": "ACCURATE",
    "INDIRECT_NOT_REVIEW": "ACCURATE",
    "CONTRADICT": "NOT_ACCURATE",
    "NOT_SUBSTANTIATE": "NOT_ACCURATE",
    "OVERSIMPLIFY": "NOT_ACCURATE",
    "MISQUOTE": "NOT_ACCURATE",
    "ETIQUETTE": "NOT_ACCURATE",
    "IRRELEVANT": "NEI",
}


def normalize_claim(c: str) -> str:
    c = re.sub(r"<\|(?:multi_)?cit\|>|<CITATION_MARKER>|</CITATION_MARKER>", " ", c)
    c = re.sub(r"\[[\s\d,;–-]*\]", " ", c)  # [3], [3-5], and leftovers such as "[, 7]" or "[,]"
    c = re.sub(r"\[[\s\d,;–-]*$", " ", c)
    c = re.sub(r"\(\s*(?:\d+\s*[-–,]?\s*)+\)", " ", c)
    c = re.sub(r"\s+([.,;:])", r"\1", c)
    return re.sub(r"\s+", " ", c).strip()


_corpus = None
_raw = None


def raw_labels(split: str):
    """claim text -> annotator label from the raw annotations (annotations.zip). The multivers-format files drop the
    label of citations without evidence segments (ETIQUETTE and IRRELEVANT both become 'no evidence'); the paper
    maps ETIQUETTE to NOT_ACCURATE and IRRELEVANT to NEI."""
    global _raw
    if _raw is None:
        import zipfile
        z = zipfile.ZipFile(ROOT.parent / "annotations.zip")
        _raw = {}
        for f in z.namelist():
            if "/citations/" not in f or not f.endswith(".json") or "__MACOSX" in f:
                continue
            d = json.loads(z.read(f))
            sp = f.split("/")[1].lower()
            ctx = d["citing_paragraph"][min(c["start"] for c in d["citation_context"]) : max(c["end"] for c in d["citation_context"])].strip()
            for key in (" ".join(c["text"] for c in d["citation_context"]).strip(), ctx):
                _raw[(sp, key)] = d["label"]
    return {k[1]: v for k, v in _raw.items() if k[0] == split}


def corpus():
    global _corpus
    if _corpus is None:
        _corpus = {}
        for line in open(ROOT / "corpus.jsonl", encoding="utf-8"):
            d = json.loads(line)
            _corpus[d["doc_id"]] = d["abstract"]
    return _corpus


def load(split: str, mapping: str | None = None):
    """Returns list of dicts: claim, label, fine, sents (list[str]), gold (set of sentence positions).
    mapping 'paper' (or env CI_MAP=paper): labels exactly as Sarol et al. (ETIQUETTE without evidence -> NOT_ACCURATE);
    default 'legacy': every citation without evidence segments -> NEI (what the shipped verifier was trained on)."""
    import os

    mapping = mapping or os.environ.get("CI_MAP", "legacy")
    raw = raw_labels(split) if mapping == "paper" else None
    C = corpus()
    out = []
    for line in open(ROOT / f"claims-{split}.jsonl", encoding="utf-8"):
        d = json.loads(line)
        sents, pos = [], {}
        for doc in sorted(d["cited_doc_ids"]):
            for j, s in enumerate(C.get(doc, [])):
                pos[(doc, j)] = len(sents)
                sents.append(s)
        gold, fines = set(), set()
        for doc, evs in d["evidence"].items():
            for e in evs:
                fines.add(e["label"])
                for j in e["sentences"]:
                    if (int(doc), j) in pos:
                        gold.add(pos[(int(doc), j)])
        fine = sorted(fines)[0] if fines else "NO_EVIDENCE"
        # if several fine labels, prefer an error label (annotation priority: major > minor > accurate)
        for pref in ["CONTRADICT", "NOT_SUBSTANTIATE", "IRRELEVANT", "OVERSIMPLIFY", "MISQUOTE", "INDIRECT", "INDIRECT_NOT_REVIEW", "ETIQUETTE", "ACCURATE"]:
            if pref in fines:
                fine = pref
                break
        if raw is not None and fine == "NO_EVIDENCE":
            fine = raw[d["claim"].strip()]
        label = FINE_TO_3.get(fine, "NEI")
        out.append({"id": d["id"], "claim": normalize_claim(d["claim"]), "raw_claim": d["claim"], "label": label, "fine": fine, "sents": sents, "gold": gold})
    return out


if __name__ == "__main__":
    from collections import Counter

    for s in ["train", "dev", "test"]:
        D = load(s)
        print(s, len(D), Counter(x["label"] for x in D), "avg sents", sum(len(x["sents"]) for x in D) / len(D))
