import torch, numpy as np, onnxruntime as ort
from transformers import AutoTokenizer, AutoModelForSequenceClassification
c = "The Transformer relies entirely on attention mechanisms, dispensing with recurrence."
e = "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely."
tok = AutoTokenizer.from_pretrained("runs/deb_base_k5/best")
m = AutoModelForSequenceClassification.from_pretrained("runs/deb_base_k5/best").eval()
enc = tok(c, e, return_tensors="pt")
with torch.no_grad(): print("pytorch", torch.softmax(m(**enc).logits, -1).numpy().round(3))
s = ort.InferenceSession("../app/public/models/veracite-verifier/onnx/model_q4.onnx", providers=["CPUExecutionProvider"])
names = {i.name for i in s.get_inputs()}
encn = tok(c, e, return_tensors="np")
lg = s.run(None, {n: encn[n].astype(np.int64) for n in names if n in encn})[0][0]
print("onnx q4 cpu", (np.exp(lg - lg.max()) / np.exp(lg - lg.max()).sum()).round(3))
print("ids", encn["input_ids"][0][:12], "types", names)
