"""CPU latency of 4-bit ONNX verifiers (4 threads ~ the browser's 4 WASM threads), 40 dev claims with k=5 evidence.
Usage: python ort_latency.py <web dir> [...]"""
import sys, time
from pathlib import Path
import numpy as np, onnxruntime as ort
from transformers import AutoTokenizer
from train_verifier import build
rows = build("dev", 5)[:40]
for d in map(Path, sys.argv[1:]):
    so = ort.SessionOptions(); so.intra_op_num_threads = 4
    s = ort.InferenceSession(str(d / "onnx" / "model_q4.onnx"), so, providers=["CPUExecutionProvider"]); tok = AutoTokenizer.from_pretrained(d)
    names = {i.name for i in s.get_inputs()}; feeds = []
    for c, e, _ in rows:
        enc = tok(c, e, truncation="only_second", max_length=512, return_tensors="np"); feeds.append({n: enc[n].astype(np.int64) for n in names if n in enc})
    s.run(None, feeds[0]); t = time.time()
    for f in feeds: s.run(None, f)
    print(f"{d}: {(d / 'onnx' / 'model_q4.onnx').stat().st_size/1e6:.0f} MB, {1000*(time.time()-t)/len(feeds):.0f} ms/claim (4 threads, mean tokens {np.mean([f['input_ids'].shape[1] for f in feeds]):.0f})")
