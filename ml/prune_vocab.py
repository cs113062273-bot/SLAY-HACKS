"""Vocabulary pruning for DeBERTa-v3 (SentencePiece Unigram, 128k pieces): keep the pieces a large
scientific corpus actually uses (+ all single characters, byte fallbacks, special tokens), slice the
embedding matrix accordingly. Shrinks the browser download; accuracy is re-measured, not assumed.

Usage: python prune_vocab.py --run runs/deb_base_all --out runs/deb_base_all_pruned
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer, PreTrainedTokenizerFast

ROOT = Path(__file__).resolve().parent.parent / "data"


def corpus():
    texts = []
    for line in open(ROOT / "Citation-Integrity/Data/multivers-format/corpus.jsonl", encoding="utf-8"):
        texts.extend(json.loads(line)["abstract"])
    for f in ["claims-train.jsonl", "claims-dev.jsonl", "claims-test.jsonl"]:
        for line in open(ROOT / "Citation-Integrity/Data/multivers-format" / f, encoding="utf-8"):
            texts.append(json.loads(line)["claim"])
    for line in open(ROOT / "scifact/data/corpus.jsonl", encoding="utf-8"):
        d = json.loads(line)
        texts.append(d["title"])
        texts.extend(d["abstract"])
    for e in json.load(open(ROOT / "semanticcite/SemanticCite_dataset.json", encoding="utf-8")):
        texts.append(e["input"]["claim"])
        texts.extend(s["text"] for s in e["input"]["ref_snippets"])
    # abstracts and titles from the scholarly-index cache (CS-heavy: S2, OpenAlex, DataCite, Crossref)
    cache = ROOT / "cache/http.json"
    if cache.exists():
        raw = open(cache, encoding="utf-8").read()
        texts.extend(m.encode().decode("unicode_escape", errors="ignore") for m in re.findall(r'"(?:abstract|title|description)":\s*"((?:[^"\\]|\\.){20,4000})"', raw))
    for f in (ROOT / "hallmark/data/v1.2").glob("*.jsonl"):
        for line in open(f, encoding="utf-8"):
            try:
                d = json.loads(line)
                texts.append(d["fields"].get("title", ""))
            except Exception:
                pass
    return [t for t in texts if t]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--min_count", type=int, default=1)
    a = ap.parse_args()
    src = Path(a.run) / "best"
    tok = AutoTokenizer.from_pretrained(src)
    tj = json.loads(tok.backend_tokenizer.to_str())
    assert tj["model"]["type"] == "Unigram", tj["model"]["type"]
    vocab = tj["model"]["vocab"]  # [[piece, score], ...]
    texts = corpus()
    print("corpus texts", len(texts))
    cnt = Counter()
    for i in range(0, len(texts), 2000):
        for ids in tok(texts[i : i + 2000], add_special_tokens=False)["input_ids"]:
            cnt.update(ids)
    keep = {i for i, c in cnt.items() if c >= a.min_count}
    keep |= set(tok.all_special_ids)
    for i, (piece, _) in enumerate(vocab):
        p = piece.replace("▁", "")
        if len(p) <= 1 or re.fullmatch(r"<0x[0-9A-F]{2}>", piece) or piece.startswith("[") and piece.endswith("]"):
            keep.add(i)
    keep = sorted(i for i in keep if i < len(vocab))
    print(f"kept {len(keep)} / {len(vocab)} pieces")
    # added tokens (e.g. [MASK]=128000) live beyond the Unigram vocab: append them after the kept pieces
    added = sorted({t["id"] for t in tj.get("added_tokens", []) if t["id"] >= len(vocab)})
    rows = keep + added
    old2new = {o: n for n, o in enumerate(rows)}
    tj["model"]["vocab"] = [vocab[i] for i in keep]
    if tj["model"].get("unk_id") is not None:
        tj["model"]["unk_id"] = old2new[tj["model"]["unk_id"]]
    for t in tj.get("added_tokens", []):
        t["id"] = old2new[t["id"]]
    # post-processor template ids
    pp = json.dumps(tj.get("post_processor"))
    for name, tid in [(t, tok.convert_tokens_to_ids(t)) for t in [tok.cls_token, tok.sep_token, tok.pad_token, tok.unk_token, tok.mask_token] if t]:
        pp = pp.replace(f'"ids": [{tid}]', f'"ids": [{old2new[tid]}]')
    tj["post_processor"] = json.loads(pp)

    out = Path(a.out) / "best"
    out.mkdir(parents=True, exist_ok=True)
    from tokenizers import Tokenizer

    new_backend = Tokenizer.from_str(json.dumps(tj))
    new_tok = PreTrainedTokenizerFast(tokenizer_object=new_backend, bos_token=tok.cls_token, eos_token=tok.sep_token, unk_token=tok.unk_token, sep_token=tok.sep_token, pad_token=tok.pad_token, cls_token=tok.cls_token, mask_token=tok.mask_token)
    cfg_tok = json.load(open(src / "tokenizer_config.json", encoding="utf-8"))
    new_tok.save_pretrained(out)
    # keep the DeBERTa tokenizer class name so transformers.js picks the right pre/post-processing
    tc = json.load(open(out / "tokenizer_config.json", encoding="utf-8"))
    tc["tokenizer_class"] = cfg_tok.get("tokenizer_class", "DebertaV2Tokenizer")
    for k in ["do_lower_case", "split_by_punct", "vocab_type", "model_max_length"]:
        if k in cfg_tok:
            tc[k] = cfg_tok[k]
    json.dump(tc, open(out / "tokenizer_config.json", "w", encoding="utf-8"), indent=1)

    model = AutoModelForSequenceClassification.from_pretrained(src)
    emb = model.get_input_embeddings()
    new_emb = torch.nn.Embedding(len(rows), emb.weight.shape[1], padding_idx=old2new.get(tok.pad_token_id))
    new_emb.weight.data = emb.weight.data[rows].clone()
    model.set_input_embeddings(new_emb)
    model.config.vocab_size = len(rows)
    model.config.pad_token_id = old2new.get(tok.pad_token_id)
    model.save_pretrained(out)
    meta = json.load(open(src / "veracite.json"))
    meta["pruned_vocab"] = len(keep)
    json.dump(meta, open(out / "veracite.json", "w"), indent=1)

    # identical tokenization on held-out style text?
    sample = texts[::997][:300]
    same = sum(tok(t)["input_ids"] == [rows[i] for i in new_tok(t)["input_ids"]] for t in sample)
    print(f"identical tokenization on {same}/{len(sample)} sampled texts")


if __name__ == "__main__":
    main()
