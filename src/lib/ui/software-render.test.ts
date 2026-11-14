import { describe, expect, it } from 'bun:test';
import { drawsInSoftware, softwareHintDue } from './software-render';

describe('a browser that draws without the video card', () => {
  it('is told by its WebGL renderer, or by having no WebGL at all', () => {
    expect(drawsInSoftware('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
    expect(drawsInSoftware('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(drawsInSoftware('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)')).toBe(true);
    expect(drawsInSoftware(null)).toBe(true);
  });
  it('is told by the browser refusing a context it would draw slowly, whatever the name says', () => {
    // Firefox hides the renderer's name; the caveat speaks for any browser.
    expect(drawsInSoftware('ANGLE (AMD, AMD Radeon R7 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', true)).toBe(true);
  });
  it('a video card is not', () => {
    expect(drawsInSoftware('ANGLE (AMD, AMD Radeon R7 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(drawsInSoftware('Apple GPU')).toBe(false);
  });
});

describe('the hint about it', () => {
  function memory() {
    const kept = new Map<string, string>();
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
  }

  it('is due once on a device', () => {
    const storage = memory();
    expect(softwareHintDue(storage)).toBe(true);
    expect(softwareHintDue(storage)).toBe(false);
  });

  it('is not due where nothing can be remembered, rather than every visit', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(softwareHintDue(broken)).toBe(false);
  });
});
