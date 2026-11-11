"""Small Windows Triton JIT check for Ming Tiny's isolated runtime."""
import torch
import triton
import triton.language as tl


@triton.jit
def add_one(input_ptr, output_ptr, size: tl.constexpr, BLOCK: tl.constexpr):
    offsets = tl.program_id(0) * BLOCK + tl.arange(0, BLOCK)
    values = tl.load(input_ptr + offsets, offsets < size, other=0)
    tl.store(output_ptr + offsets, values + 1, offsets < size)


values = torch.arange(1024, device="cuda", dtype=torch.float32)
output = torch.empty_like(values)
add_one[(triton.cdiv(values.numel(), 256),)](values, output, values.numel(), 256)
torch.cuda.synchronize()
assert torch.equal(output, values + 1)
print("Triton JIT on CUDA passed", torch.cuda.get_device_name(0))
