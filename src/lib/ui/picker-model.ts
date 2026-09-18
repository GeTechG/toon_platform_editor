/**
 * The three colour models of the reference ColourPicker, as the geometry of
 * one surface plus one bar. Everything is in pointer units (0..1, y = 0 at
 * the top of the surface) so the component only draws and the maths is
 * testable.
 */

import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, wheelToHsv, type Hsv } from './color-model';

export type PickerModel = 'hsv' | 'rgb' | 'wheel';

export interface Pointer {
  x: number;
  y: number;
  bar: number;
}

/** How many steps an arrow key has to cross each axis, per model. */
const RANGES: Readonly<Record<PickerModel, Pointer>> = {
  // surface: saturation × value, bar: hue.
  hsv: { x: 100, y: 100, bar: 360 },
  // surface: blue × green, bar: red.
  rgb: { x: 255, y: 255, bar: 255 },
  // surface: the hue/saturation wheel, bar: value.
  wheel: { x: 100, y: 100, bar: 100 },
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function pointerToColor(model: PickerModel, { x, y, bar }: Pointer): string {
  if (model === 'rgb') {
    return rgbToHex({ r: bar * 255, g: (1 - y) * 255, b: x * 255 });
  }
  if (model === 'wheel') {
    const { h, s } = wheelToHsv(x * 2 - 1, y * 2 - 1);
    return rgbToHex(hsvToRgb({ h, s, v: bar * 100 }));
  }
  return rgbToHex(hsvToRgb({ h: bar * 360, s: x * 100, v: (1 - y) * 100 }));
}

export function colorToPointer(model: PickerModel, hex: string): Pointer {
  const rgb = hexToRgb(hex);
  if (model === 'rgb') {
    return { x: rgb.b / 255, y: 1 - rgb.g / 255, bar: rgb.r / 255 };
  }
  const hsv: Hsv = rgbToHsv(rgb);
  if (model === 'wheel') {
    const a = (hsv.h * Math.PI) / 180;
    const r = hsv.s / 100;
    return { x: (Math.cos(a) * r + 1) / 2, y: (Math.sin(a) * r + 1) / 2, bar: hsv.v / 100 };
  }
  return { x: hsv.s / 100, y: 1 - hsv.v / 100, bar: hsv.h / 360 };
}

/**
 * Arrow keys move the pointer one axis unit (Shift: ten); with Alt they drive
 * the bar instead of the surface. Any other key leaves the pointer alone.
 */
export function nudgePointer(
  model: PickerModel,
  p: Pointer,
  key: string,
  { shift = false, alt = false }: { shift?: boolean; alt?: boolean },
): Pointer {
  const dir = key === 'ArrowRight' || key === 'ArrowUp' ? 1 : key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 0;
  if (dir === 0) return p;
  const range = RANGES[model];
  const step = (dir * (shift ? 10 : 1)) / (alt ? range.bar : key === 'ArrowLeft' || key === 'ArrowRight' ? range.x : range.y);
  if (alt) return { ...p, bar: clamp01(p.bar + step) };
  // The surface's y grows downward, so ArrowUp has to subtract.
  if (key === 'ArrowLeft' || key === 'ArrowRight') return { ...p, x: clamp01(p.x + step) };
  return { ...p, y: clamp01(p.y - step) };
}

/**
 * Where to read the surface from while painting the bar. The hue strip is a
 * full rainbow whatever the surface holds — otherwise a dark or grey colour
 * would paint it black; the red and value bars do show their ramp against
 * the current surface, which is what makes them readable.
 */
export function barPointer(model: PickerModel, p: Pointer): Pointer {
  return model === 'hsv' ? { ...p, x: 1, y: 0 } : p;
}
