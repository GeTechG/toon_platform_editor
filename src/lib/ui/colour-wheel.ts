/**
 * The geometry of the colours window (ColoursPanel): the disc that holds the
 * whole saturation × value square, the hue of a point on a ring or a wheel,
 * the harmonies, and the row of colours picked last. Pure, so `bun test`
 * covers the maths and the component only draws.
 */

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export interface Point {
  x: number;
  y: number;
}

/**
 * A point of the square −1..1 as a point of the unit disc (the elliptical
 * grid mapping): the corners — white, the pure hue, black — land on the rim
 * instead of being cut off, as a square clipped to a circle cuts them.
 */
export function squareToDisc(x: number, y: number): Point {
  return { x: x * Math.sqrt(1 - (y * y) / 2), y: y * Math.sqrt(1 - (x * x) / 2) };
}

/** The way back; a point past the rim is read as the rim under it. */
export function discToSquare(u: number, v: number): Point {
  const r = Math.hypot(u, v);
  if (r > 1) {
    u /= r;
    v /= r;
  }
  const root = (n: number) => Math.sqrt(Math.max(0, n));
  const a = 2 + u * u - v * v;
  const b = 2 - u * u + v * v;
  const k = 2 * Math.SQRT2;
  return {
    x: clamp((root(a + k * u) - root(a - k * u)) / 2, -1, 1),
    y: clamp((root(b + k * v) - root(b - k * v)) / 2, -1, 1),
  };
}

/**
 * The hue under a screen offset from the centre (y grows downward): red on
 * the right, then against the clock — the way the ring and the wheel are
 * painted (`conic-gradient` in ColoursPanel).
 */
export function pointHue(dx: number, dy: number): number {
  return (Math.round((Math.atan2(-dy, dx) * 180) / Math.PI) + 360) % 360;
}

/** Where a hue sits on a circle of radius `r`, as a screen offset from the centre. */
export function huePoint(h: number, r: number): Point {
  const a = (h * Math.PI) / 180;
  return { x: Math.cos(a) * r, y: -Math.sin(a) * r };
}

export const HARMONIES = ['complementary', 'split', 'analogous', 'triadic', 'tetradic'] as const;
export type Harmony = (typeof HARMONIES)[number];

const OFFSETS: Readonly<Record<Harmony, readonly number[]>> = {
  complementary: [180],
  split: [150, 210],
  analogous: [30, -30],
  triadic: [120, 240],
  tetradic: [90, 180, 270],
};

/** The hues that go with `h` under a harmony — the chosen one itself is not among them. */
export function harmonyHues(h: number, harmony: Harmony): number[] {
  return OFFSETS[harmony].map((offset) => (((h + offset) % 360) + 360) % 360);
}

export const HISTORY_MAX = 10;

/** The colours picked last: the newest first, each once. */
export function pushHistory(list: readonly string[], colour: string): string[] {
  const next = colour.toLowerCase();
  return [next, ...list.filter((c) => c !== next)].slice(0, HISTORY_MAX);
}

const HISTORY_KEY = 'toon-editor:colour-history';

export function loadHistory(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c)).slice(0, HISTORY_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Best-effort, never throws. */
export function saveHistory(list: readonly string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // private mode / blocked storage — the row lives for the session.
  }
}
