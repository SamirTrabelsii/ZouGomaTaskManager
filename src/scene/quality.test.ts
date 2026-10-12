import { describe, expect, it } from 'vitest';
import { pickAutoQuality } from './quality';

describe('pickAutoQuality', () => {
  it('keeps high on capable machines, so their look is unchanged', () => {
    expect(pickAutoQuality({ width: 1920, cores: 12, memoryGB: 8, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)' })).toBe('high');
    expect(pickAutoQuality({ width: 1440, cores: 8, gpu: 'Apple M2' })).toBe('high');
    expect(pickAutoQuality({ width: 1440, cores: 14, gpu: 'ANGLE (Intel, Intel(R) Graphics (0x00007D45) Direct3D11)' })).toBe('high');
    expect(pickAutoQuality({ width: 1280 })).toBe('balanced'); // nothing known and default 4 cores → cautious
  });
  it('steps down to balanced for weak GPUs, few cores or little memory', () => {
    expect(pickAutoQuality({ width: 1366, cores: 8, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)' })).toBe('balanced');
    expect(pickAutoQuality({ width: 1366, cores: 8, gpu: 'Mali-G52' })).toBe('balanced');
    expect(pickAutoQuality({ width: 1366, cores: 4, gpu: 'Apple M1' })).toBe('balanced');
    expect(pickAutoQuality({ width: 1366, cores: 8, memoryGB: 4 })).toBe('balanced');
  });
  it('uses low for software rendering, tiny screens, ≤2 cores or ≤2 GB', () => {
    expect(pickAutoQuality({ width: 1920, cores: 8, gpu: 'Google SwiftShader' })).toBe('low');
    expect(pickAutoQuality({ width: 1920, cores: 8, gpu: 'llvmpipe (LLVM 15)' })).toBe('low');
    expect(pickAutoQuality({ width: 390, cores: 8, gpu: 'Apple GPU' })).toBe('low');
    expect(pickAutoQuality({ width: 1920, cores: 2, gpu: 'GeForce GTX 1050' })).toBe('low');
    expect(pickAutoQuality({ width: 1920, cores: 8, memoryGB: 2 })).toBe('low');
  });
});
