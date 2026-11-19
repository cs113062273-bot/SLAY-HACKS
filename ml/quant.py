"""Accuracy-safe int8 quantization for DeBERTa-style encoders: quantize weight MatMuls only (per channel),
keep activation×activation MatMuls (attention scores, disentangled position terms) in fp32."""
import sys, onnx
from onnxruntime.quantization import QuantType, quantize_dynamic
def safe_quantize(src, dst, embeddings=True):
    m = onnx.load(src, load_external_data=True)
    inits = {i.name for i in m.graph.initializer}
    # constants produced by Constant nodes also count as weights
    consts = {o for n in m.graph.node if n.op_type == "Constant" for o in n.output}
    exclude = [n.name for n in m.graph.node if n.op_type == "MatMul" and not (n.input[1] in inits or n.input[1] in consts)]
    ops = ["MatMul"] + (["Gather"] if embeddings else [])
    quantize_dynamic(src, dst, weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=ops, nodes_to_exclude=exclude)
    return len(exclude)
if __name__ == "__main__":
    print("excluded activation matmuls:", safe_quantize(sys.argv[1], sys.argv[2], embeddings=len(sys.argv) < 4))
