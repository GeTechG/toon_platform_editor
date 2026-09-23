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
  /** RGB model only: the column the last click landed in, for the marker. */
  channel?: 0 | 1 | 2;
}

/** Which of the three RGB columns a surface x falls in; the gaps snap to a column. */
export function rgbChannelAt(fx: number): 0 | 1 | 2 {
  return Math.min(2, Math.max(0, Math.floor(fx * 3))) as 0 | 1 | 2;
}

/**
 * Where a surface click lands. Two axes in the hsv and wheel models; in the
 * rgb model the surface is three vertical channel columns (`bundle:10046-10064`),
 * so x picks the column and y its value, leaving the other two channels alone.
 */
export function surfaceToPointer(model: PickerModel, p: Pointer, fx: number, fy: number): Pointer {
  if (model === 'wheel') return onWheel({ ...p, x: fx, y: fy });
  if (model !== 'rgb') return { ...p, x: fx, y: fy };
  const channel = rgbChannelAt(fx);
  const value = 1 - fy;
  // rgb pointer axes: r = bar, g = 1 - y, b = x.
  if (channel === 0) return { ...p, bar: value, channel };
  if (channel === 1) return { ...p, y: fy, channel };
  return { ...p, x: value, channel };
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

/** The wheel's corners are clipped away: a pointer past the rim is pulled back onto it. */
function onWheel(p: Pointer): Pointer {
  const dx = p.x - 0.5;
  const dy = p.y - 0.5;
  const r = Math.hypot(dx, dy);
  return r <= 0.5 ? p : { ...p, x: 0.5 + (dx / r) * 0.5, y: 0.5 + (dy / r) * 0.5 };
}

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
 * Arrow keys move the pointer one axis unit (Shift: five, `bundle:9925-9941`)
 * along `target`, the surface or the bar the pointer last touched; Alt flips
 * that target for this one step. PageUp / PageDown are ten units up and down,
 * Home / End the ends of the horizontal axis (or of the bar) — the slider
 * keys the reference had no use for. In the rgb model the marker moves to the
 * channel the key changes: blue sideways, green up and down, red on the bar.
 * Any other key leaves the pointer alone.
 */
export function nudgePointer(
  model: PickerModel,
  p: Pointer,
  key: string,
  { shift = false, alt = false, target = 'surface' }: { shift?: boolean; alt?: boolean; target?: 'surface' | 'bar' },
): Pointer {
  const onBar = alt ? target === 'surface' : target === 'bar';
  const mark = (next: Pointer, channel: 0 | 1 | 2): Pointer => (model === 'rgb' ? { ...next, channel } : next);
  if (key === 'Home' || key === 'End') {
    const end = key === 'End' ? 1 : 0;
    if (onBar) return mark({ ...p, bar: end }, 0);
    return model === 'wheel' ? onWheel({ ...p, x: end }) : mark({ ...p, x: end }, 2);
  }
  const page = key === 'PageUp' || key === 'PageDown';
  const arrow = key === 'PageUp' ? 'ArrowUp' : key === 'PageDown' ? 'ArrowDown' : key;
  const dir = arrow === 'ArrowRight' || arrow === 'ArrowUp' ? 1 : arrow === 'ArrowLeft' || arrow === 'ArrowDown' ? -1 : 0;
  if (dir === 0) return p;
  const across = arrow === 'ArrowLeft' || arrow === 'ArrowRight';
  const range = RANGES[model];
  const step = (dir * (page ? 10 : shift ? 5 : 1)) / (onBar ? range.bar : across ? range.x : range.y);
  if (onBar) return mark({ ...p, bar: clamp01(p.bar + step) }, 0);
  const next = across ? { ...p, x: clamp01(p.x + step) } : { ...p, y: clamp01(p.y - step) };
  if (model === 'wheel') return onWheel(next);
  // The surface's y grows downward, so ArrowUp has to subtract.
  return mark(next, across ? 2 : 1);
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

/**
 * What Enter and Space do inside the colour window (`bundle:9942-9987`): on
 * the surface and the bar they close on what is chosen, in a field Enter
 * commits the typing first and Space types. A key presses itself — the model
 * segments, «исходный», the cross — so the window leaves it alone.
 */
export function pickerKeyAction(key: string, tagName: string): 'close' | 'commit' | null {
  if (key !== 'Enter' && key !== ' ') return null;
  if (tagName === 'BUTTON') return null;
  if (tagName === 'INPUT') return key === 'Enter' ? 'commit' : null;
  return 'close';
}
