import { describe, expect, it } from 'bun:test';
import {
  VramBudget,
  atlasLogicalSizeForTier,
  planSceneVram,
  sheetTextureBytes,
  atlasBytes,
  studioVramBudget,
} from './vram-budget';

const MB = 1024 * 1024;

describe('VRAM budget and scene preflight', () => {
  it('computes exact 1920x1920 streaming subtotal <= 55.87 MiB on 64 MiB tier and 20.73 MiB on 1280x720', () => {
    const plan1920 = planSceneVram({
      budgetBytes: 64 * MB,
      sheetWidth: 1920,
      sheetHeight: 1920,
      formats: { color: 'R8', stencil: 'DEPTH24_STENCIL8' },
      supersample: 4,
      needsMipmap: true,
      hasGhosts: false,
      hasBlend: true,
      hasLiveCoat: true,
    });
    expect(plan1920.fits).toBe(true);
    // 55.875 MiB + 0.25 MiB bounded 256x256 RGBA8 native-fallback scratch tile = 56.125 MiB
    expect(plan1920.workingBytes / MB).toBeCloseTo(56.125, 2);
    expect(plan1920.retainedHeadroomBytes).toBeGreaterThan(0);

    const plan720 = planSceneVram({
      budgetBytes: 64 * MB,
      sheetWidth: 1280,
      sheetHeight: 720,
      formats: { color: 'R8', stencil: 'DEPTH24_STENCIL8' },
      supersample: 4,
      needsMipmap: true,
      hasGhosts: true,
      hasBlend: true,
      hasLiveCoat: true,
    });
    expect(plan720.fits).toBe(true);
    // 1280x720 with pinned #under ghost buffer still fits easily in 64 MiB!
    expect(plan720.retainedHeadroomBytes).toBeGreaterThan(35 * MB);
  });

  it('rejects a 1920x1920 scene on 64 MiB when pinned ghost buffer #under pushes required surfaces past budget (J1-O5)', () => {
    const plan = planSceneVram({
      budgetBytes: 64 * MB,
      sheetWidth: 1920,
      sheetHeight: 1920,
      formats: { color: 'R8', stencil: 'DEPTH24_STENCIL8' },
      supersample: 4,
      needsMipmap: true,
      hasGhosts: true,
      hasBlend: true,
      hasLiveCoat: true,
    });
    // 55.875 MiB + 14.0625 MiB pinned #under = 69.9375 MiB > 64 MiB -> preflight cleanly routes to Canvas 2D
    expect(plan.fits).toBe(false);
    expect(plan.workingBytes).toBeGreaterThan(64 * MB);
  });

  it('accepts 1920x1920 with ghosts + blend + live coat on 128 MiB tier', () => {
    const plan = planSceneVram({
      budgetBytes: 128 * MB,
      sheetWidth: 1920,
      sheetHeight: 1920,
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      supersample: 4,
      needsMipmap: true,
      hasGhosts: true,
      hasBlend: true,
      hasLiveCoat: true,
    });
    expect(plan.fits).toBe(true);
    expect(atlasLogicalSizeForTier(128 * MB, 4)).toBe(512);
    expect(atlasLogicalSizeForTier(64 * MB, 4)).toBe(256);
    expect(atlasBytes(256, 4, { color: 'R8', stencil: 'STENCIL_INDEX8' })).toBe(2 * MB);
    expect(sheetTextureBytes(1920, 1920, false)).toBe(1920 * 1920 * 4);
  });

  it('proactively evicts oldest retained entries before allocating and discards generation on OUT_OF_MEMORY', () => {
    const freed: string[] = [];
    const budget = new VramBudget(10 * MB);
    budget.reserveWorking(4 * MB);
    expect(budget.tryRetain('a', 3 * MB, () => freed.push('a'))).toBe(true);
    expect(budget.tryRetain('b', 3 * MB, () => freed.push('b'))).toBe(true);
    expect(freed).toEqual([]);
    // Adding 2 MB evicts 'a' proactively before GL allocation.
    expect(budget.tryRetain('c', 2 * MB, () => freed.push('c'))).toBe(true);
    expect(freed).toEqual(['a']);

    // Request larger than remaining headroom fails without touching retained entries if it can never fit.
    expect(budget.tryRetain('huge', 8 * MB, () => freed.push('huge'))).toBe(false);

    // GL OUT_OF_MEMORY poisons the budget generation and frees everything.
    budget.markOutOfMemory();
    expect(budget.oom).toBe(true);
    expect(freed).toEqual(['a', 'b', 'c']);
    expect(budget.tryRetain('d', 1 * MB, () => {})).toBe(false);
  });

  it('promotes desktop browsers without navigator.deviceMemory (Firefox/Waterfox/Safari) to 128 MiB / 512x512 atlas while keeping mobile/small GPUs at 64 MiB', () => {
    // Explicit deviceMemory always follows the 64 / 128 / 256 MiB tiers.
    expect(studioVramBudget({ deviceMemory: 8, maxTextureSize: 16384, coarsePointer: false })).toBe(256 * MB);
    expect(studioVramBudget({ deviceMemory: 4, maxTextureSize: 16384, coarsePointer: false })).toBe(128 * MB);
    expect(studioVramBudget({ deviceMemory: 2, maxTextureSize: 16384, coarsePointer: false })).toBe(64 * MB);

    // Firefox / Waterfox / Safari desktop (deviceMemory === undefined, fine pointer, >= 8192 texture limit):
    const desktopNoMem = studioVramBudget({ deviceMemory: undefined, maxTextureSize: 16384, coarsePointer: false });
    expect(desktopNoMem).toBe(128 * MB);
    expect(atlasLogicalSizeForTier(desktopNoMem, 4)).toBe(512);

    // Mobile / tablet or older GPU without deviceMemory stays conservative at 64 MiB.
    expect(studioVramBudget({ deviceMemory: undefined, maxTextureSize: 16384, coarsePointer: true })).toBe(64 * MB);
    expect(studioVramBudget({ deviceMemory: undefined, maxTextureSize: 4096, coarsePointer: false })).toBe(64 * MB);
  });
});
