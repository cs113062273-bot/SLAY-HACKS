"""Load a PyTorch Lightning checkpoint with torch's weights_only unpickler: unknown classes are replaced by inert stubs
(no code from the file runs), then keep only the tensor state_dict."""
import re, sys, torch

def stub(qual):
    mod, name = qual.rsplit(".", 1)
    cls = type(name, (), {"__setstate__": lambda self, st: None, "__init__": lambda self, *a, **k: None})
    cls.__module__ = mod
    return cls

def load(path):
    allowed = []
    for _ in range(50):
        try:
            with torch.serialization.safe_globals(allowed):
                return torch.load(path, map_location="cpu", weights_only=True)
        except Exception as e:
            m = re.search(r"Unsupported global: GLOBAL ([\w.]+)", str(e))
            if not m: raise
            print("stub", m.group(1), flush=True); allowed.append(stub(m.group(1)))
    raise RuntimeError("too many globals")

if __name__ == "__main__":
    ck = load(sys.argv[1]); sd = ck["state_dict"]
    print(len(sd), [(k, tuple(v.shape)) for k, v in sd.items() if "encoder.layer." not in k][:30])
    torch.save({k: (v.half() if v.is_floating_point() else v) for k, v in sd.items()}, sys.argv[2])
