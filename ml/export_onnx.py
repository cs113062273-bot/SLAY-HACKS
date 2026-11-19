"""Export a trained verifier to ONNX (fp32 + dynamic int8) in the layout transformers.js expects,
then re-evaluate the int8 model on dev so the browser model's accuracy is measured, not assumed.

Usage: python export_onnx.py --run runs/deb_base_k10 --out ../app/public/models/veracite-verifier
"""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
import onnx
from sklearn.metrics import f1_score
from transformers import AutoTokenizer

from train_verifier import build


def untie_matmul_weights(model):
    """DeBERTa reuses query/key projection weights for its relative-position projections. The 4-bit
    quantizer skips initializers with several consumers, leaving them fp32; give each MatMul its own copy."""
    from onnx import numpy_helper

    inits = {i.name: i for i in model.graph.initializer}
    # Identity(initializer) feeds the relative-position projections: replace with direct copies
    folded = 0
    for n in list(model.graph.node):
        if n.op_type == "Identity" and n.input[0] in inits:
            arr = numpy_helper.to_array(inits[n.input[0]])
            t = numpy_helper.from_array(arr.copy(), n.output[0])
            model.graph.initializer.append(t)
            inits[t.name] = t
            model.graph.node.remove(n)
            folded += 1
    print("folded Identity weights:", folded)
    uses = {}
    for n in model.graph.node:
        if n.op_type == "MatMul" and n.input[1] in inits:
            uses.setdefault(n.input[1], []).append(n)
    added = 0
    for name, nodes in uses.items():
        for j, n in enumerate(nodes[1:], 1):
            arr = numpy_helper.to_array(inits[name])
            t = numpy_helper.from_array(arr.copy(), f"{name}__untied{j}")
            model.graph.initializer.append(t)
            n.input[1] = t.name
            added += 1
    # also untie weights shared through a Transpose (pooler/classifier style)
    print("untied MatMul weights:", added)
    return model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--split", default="dev")
    a = ap.parse_args()
    src = Path(a.run) / "best"
    out = Path(a.out)
    (out / "onnx").mkdir(parents=True, exist_ok=True)
    meta = json.load(open(src / "veracite.json"))
    k = meta["args"]["k"]
    k = meta["args"]["k"]

    from optimum.onnxruntime import ORTModelForSequenceClassification

    tmp = Path(a.run) / "onnx_tmp"
    m = ORTModelForSequenceClassification.from_pretrained(src, export=True)
    m.save_pretrained(tmp)
    tok = AutoTokenizer.from_pretrained(src)
    tok.save_pretrained(out)
    shutil.copy(tmp / "config.json", out / "config.json")
    fp32 = tmp / "model.onnx"
    # Weight-only 4-bit MatMuls (activations stay fp32; dynamic int8 activation quantization breaks
    # DeBERTa's disentangled attention) + int8 embedding rows. Served as model_q4.onnx (dtype "q4").
    q8 = out / "onnx" / "model_q4.onnx"
    qz = MatMulNBitsQuantizer(untie_matmul_weights(onnx.load(str(fp32))), block_size=32, is_symmetric=True)
    qz.process()
    tmpq = Path(a.run) / "q4_tmp.onnx"
    qz.model.save_model_to_file(str(tmpq), use_external_data_format=False)
    quantize_dynamic(str(tmpq), str(q8), weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=["Gather"])
    json.dump({**meta, "k": k}, open(out / "veracite.json", "w"), indent=1)
    print("q4 size MB:", round(q8.stat().st_size / 1e6, 1))

    # accuracy of the int8 model on the requested split
    sess = ort.InferenceSession(str(q8), providers=["CPUExecutionProvider"])
    names = {i.name for i in sess.get_inputs()}
    rows = build(a.split, k)
    logits = []
    for c, e, _ in rows:
        enc = tok(c, e, truncation="only_second", max_length=512, return_tensors="np")
        feed = {n: enc[n].astype(np.int64) for n in names if n in enc}
        logits.append(sess.run(None, feed)[0][0])
    L = np.array(logits)
    y = np.array([r[2] for r in rows])
    bias = np.array([0, *meta["bias"]])
    print(f"{a.split} q4: macro-F1 raw={f1_score(y, L.argmax(1), average='macro'):.3f} biased={f1_score(y, (L + bias).argmax(1), average='macro'):.3f} (fp32 dev raw={meta['dev_macro']:.3f}, biased={meta['dev_macro_biased']:.3f})")


if __name__ == "__main__":
    main()
