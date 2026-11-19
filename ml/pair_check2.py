import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
tok = AutoTokenizer.from_pretrained("runs/deb_base_k5/best"); m = AutoModelForSequenceClassification.from_pretrained("runs/deb_base_k5/best").eval()
c = "The Transformer relies entirely on attention mechanisms, dispensing with recurrence."
ctx = ["The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.",
       "The best performing models also connect the encoder and decoder through an attention mechanism.",
       "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
       "Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable.",
       "Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task."]
for name, ev in [("1 sentence", ctx[2]), ("5 sentences", " ".join(ctx)), ("unrelated", "Mitochondria are the powerhouse of the cell. Protein folding is driven by hydrophobic interactions."), ("contradict", "We propose a recurrent architecture; attention alone was insufficient, so recurrence is essential to the model.")]:
    with torch.no_grad(): p = torch.softmax(m(**tok(c, ev, return_tensors="pt")).logits, -1)[0].numpy().round(3)
    print(f"{name:12s} ACC/NOT/NEI = {p}")
