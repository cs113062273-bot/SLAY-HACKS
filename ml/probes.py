"""Behavioural probes: evidence-count robustness, unrelated, contradiction. Usage: python probes.py runs/X/best"""
import sys, torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
tok = AutoTokenizer.from_pretrained(sys.argv[1]); m = AutoModelForSequenceClassification.from_pretrained(sys.argv[1]).eval()
c = "The Transformer relies entirely on attention mechanisms, dispensing with recurrence."
ctx = ["The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.",
       "The best performing models also connect the encoder and decoder through an attention mechanism.",
       "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
       "Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable.",
       "Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task."]
cases = [("supported/1", ctx[2], 0), ("supported/5", " ".join(ctx), 0), ("unrelated", "Mitochondria are the powerhouse of the cell. Protein folding is driven by hydrophobic interactions.", 2),
         ("contradicted", "We propose a recurrent architecture; attention alone was insufficient, so recurrence is essential to the model.", 1)]
ok = 0
for name, ev, want in cases:
    with torch.no_grad(): p = torch.softmax(m(**tok(c, ev, return_tensors="pt")).logits, -1)[0].numpy()
    ok += int(p.argmax() == want); print(f"  {name:13s} ACC/NOT/NEI = {p.round(3)}")
print(f"probes passed {ok}/{len(cases)}")
