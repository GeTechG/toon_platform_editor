import { describe, expect, test } from 'bun:test';
import { BACKGROUND_COLOR, FIXED_POINT_SCALE } from '../format/constants';
import { createDocument } from '../model/operations';
import { exportSize, rasterViewport, stampWatermark, watermarkLayout } from './rasterize';

const doc = (logicalWidth: number, logicalHeight: number) =>
  createDocument({
    width: logicalWidth * FIXED_POINT_SCALE,
    height: logicalHeight * FIXED_POINT_SCALE,
  });

describe('exportSize', () => {
  test('the editor canvas gives the reference sizes', () => {
    expect(exportSize(doc(1280, 720), 1280)).toEqual({ width: 1280, height: 720 });
    expect(exportSize(doc(1280, 720), 2560)).toEqual({ width: 2560, height: 1440 });
    expect(exportSize(doc(1280, 720), 640)).toEqual({ width: 640, height: 360 });
  });

  test('a document of another aspect keeps its own proportion', () => {
    expect(exportSize(doc(600, 300), 1280)).toEqual({ width: 1280, height: 640 });
  });

  test('height is even — H.264 refuses odd dimensions', () => {
    expect(exportSize(doc(1280, 721), 1280).height % 2).toBe(0);
    expect(exportSize(doc(3, 1), 640).height % 2).toBe(0);
  });
});

describe('watermarkLayout', () => {
  test('reference geometry at 1:1 — 18 px bold, 3 px outline, 6 px from the corner', () => {
    expect(watermarkLayout(1280, 720, 1)).toEqual({
      fontSize: 18,
      lineWidth: 3,
      x: 1274,
      y: 714,
    });
  });

  test('the stamp grows with the export, never shrinks below it', () => {
    expect(watermarkLayout(2560, 1440, 2).fontSize).toBe(36);
    expect(watermarkLayout(640, 360, 0.5).fontSize).toBe(18);
  });
});

describe('rasterViewport', () => {
  test('scale maps document units onto the target width', () => {
    // 1280 logical px rendered into 2560 → two device px per logical px.
    expect(rasterViewport(doc(1280, 720), 2560).scale).toBe(2 / FIXED_POINT_SCALE);
  });

  test('opaque by default, transparent when asked', () => {
    expect(rasterViewport(doc(1280, 720), 1280).background).toBe(BACKGROUND_COLOR);
    expect(rasterViewport(doc(1280, 720), 1280, true).background).toBeNull();
  });
});

describe('stampWatermark', () => {
  /** Records what a real 2D context would have been told to do. */
  function fakeContext() {
    const calls: string[] = [];
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
      setTransform: (...a: number[]) => calls.push(`setTransform(${a.join(',')})`),
      strokeText: (t: string, x: number, y: number) => calls.push(`strokeText(${t},${x},${y})`),
      fillText: (t: string, x: number, y: number) => calls.push(`fillText(${t},${x},${y})`),
    };
    return { ctx, calls };
  }

  test('drops the renderer transform, outlines in white, then fills in black', () => {
    const { ctx, calls } = fakeContext();
    stampWatermark(ctx, 1280, 720, 1);
    expect(calls).toEqual([
      'setTransform(1,0,0,1,0,0)',
      'strokeText(toonop,1274,714)',
      'fillText(toonop,1274,714)',
    ]);
    expect(ctx.font).toBe('bold 18px system-ui, sans-serif');
    expect(ctx.textAlign).toBe('right');
    expect(ctx.textBaseline).toBe('bottom');
    expect(ctx.fillStyle).toBe('#000000');
  });
});
