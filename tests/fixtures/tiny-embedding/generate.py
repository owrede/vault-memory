"""Generate our original deterministic test graph; no downloaded model weights. SPDX-License-Identifier: MIT."""
import onnx
from onnx import helper, TensorProto
from pathlib import Path
root=Path(__file__).parent
inputs=[helper.make_tensor_value_info('input_ids',TensorProto.INT64,['batch','tokens']),helper.make_tensor_value_info('attention_mask',TensorProto.INT64,['batch','tokens'])]
output=helper.make_tensor_value_info('last_hidden_state',TensorProto.FLOAT,['batch','tokens',2])
nodes=[helper.make_node('Cast',['input_ids'],['values'],to=TensorProto.FLOAT),helper.make_node('Unsqueeze',['values','axes'],['first']),helper.make_node('Add',['first','one'],['second']),helper.make_node('Concat',['first','second'],['last_hidden_state'],axis=2)]
graph=helper.make_graph(nodes,'vault-memory-tiny-embedding',inputs,[output],[helper.make_tensor('axes',TensorProto.INT64,[1],[2]),helper.make_tensor('one',TensorProto.FLOAT,[1],[1.0])])
model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',13)],producer_name='vault-memory-test-fixture',ir_version=8)
onnx.checker.check_model(model)
onnx.save(model,root/'model.onnx')
