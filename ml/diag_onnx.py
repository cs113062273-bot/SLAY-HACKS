import numpy as np, onnxruntime as ort, torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from sklearn.metrics import f1_score
from train_verifier import build
run = "runs/deb_base_k5"
rows = build("dev", 5)[:80]
y = np.array([r[2] for r in rows])
tok_saved = AutoTokenizer.from_pretrained(run + "/best")
tok_base = AutoTokenizer.from_pretrained("MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli")
c, e = rows[0][0], rows[0][1]
a = tok_saved(c, e, truncation="only_second", max_length=512)["input_ids"]; b = tok_base(c, e, truncation="only_second", max_length=512)["input_ids"]
print("tokenizers identical:", a == b, len(a), len(b))
m = AutoModelForSequenceClassification.from_pretrained(run + "/best").eval()
def run_pt(tok):
    out = []
    with torch.no_grad():
        for c, e, _ in rows:
            enc = tok(c, e, truncation="only_second", max_length=512, return_tensors="pt")
            out.append(m(**enc).logits[0].numpy())
    return np.array(out)
def run_ort(path, tok):
    s = ort.InferenceSession(path, providers=["CPUExecutionProvider"]); names = {i.name for i in s.get_inputs()}
    out = []
    for c, e, _ in rows:
        enc = tok(c, e, truncation="only_second", max_length=512, return_tensors="np")
        out.append(s.run(None, {n: enc[n].astype(np.int64) for n in names if n in enc})[0][0])
    return np.array(out)
f = lambda L: round(f1_score(y, L.argmax(1), average="macro"), 3)
Lpt = run_pt(tok_base); print("pytorch base-tok", f(Lpt))


L8 = run_ort(run + "/q_nbits4.onnx", tok_base); print("onnx int8", f(L8), "max|diff|", float(np.abs(L8 - Lpt).max()))
