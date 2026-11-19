import sys, onnx
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
src, mode, dst = sys.argv[1], sys.argv[2], sys.argv[3]
if mode == "matmul_only":
    m = onnx.load(src); inits = {i.name for i in m.graph.initializer}
    ex = [n.name for n in m.graph.node if n.op_type == "MatMul" and n.input[1] not in inits]
    quantize_dynamic(src, dst, weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=["MatMul"], nodes_to_exclude=ex)
elif mode.startswith("nbits"):
    bits = int(mode[5:] or 4)
    m = onnx.load(src)
    q = MatMulNBitsQuantizer(m, block_size=32, is_symmetric=True, bits=bits) if bits != 4 else MatMulNBitsQuantizer(m, block_size=32, is_symmetric=True)
    q.process()
    tmp = dst + ".tmp.onnx"
    q.model.save_model_to_file(tmp, use_external_data_format=False)
    # embeddings: int8 Gather (rows are looked up, no activation quantization involved)
    quantize_dynamic(tmp, dst, weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=["Gather"])
