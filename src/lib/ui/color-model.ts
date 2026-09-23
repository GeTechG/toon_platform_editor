/**
 * Colour conversions behind the reference ColourPicker (toonio.bundle.js
 * `ColourPicker`): pure HSV↔RGB↔hex with integer channels, so `bun test`
 * covers the maths and the component stays drawing code.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue in degrees 0–360, saturation and value in percent 0–100. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Reference hex field: 3 or 6 digits, `#` optional; null when it is neither. */
export function parseHex(text: string): string | null {
  const body = text.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(body)) return null;
  if (body.length === 3) return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  if (body.length === 6) return `#${body}`;
  return null;
}

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|turn|rad|grad)?$/;

/** One CSS function argument as its number and unit; null when it is not one. */
function arg(text: string): { n: number; unit: string } | null {
  const m = NUMBER.exec(text);
  return m ? { n: Number(m[1]), unit: m[2] ?? '' } : null;
}

/** CSS Color 4 `hslToRgb`; `h` in degrees, `s` and `l` 0–1. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/**
 * What the colour window's field accepts, typed or pasted: `#rgb`, `#rrggbb`,
 * bare `rrggbb`, `rgb()`/`rgba()` and `hsl()`/`hsla()` in the comma or the
 * space syntax (the alpha is read and dropped), and a CSS colour name, which
 * only the browser can resolve — so it comes in as `named`. Anything unfinished
 * or unknown is null: the field paints only what it has read for certain,
 * unlike the reference, which dropped the non-hex and painted `rgb(255,0,0)`
 * as #b25500.
 */
export function parseColourInput(text: string, named?: (name: string) => string | null): string | null {
  const s = text.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s) || /^[0-9a-f]{6}$/.test(s)) return parseHex(s);
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(s);
  if (fn) {
    const args = fn[2].trim().split(/\s*[,/]\s*|\s+/).map(arg);
    if ((args.length !== 3 && args.length !== 4) || args.some((a) => !a)) return null;
    const [a, b, c, alpha] = args as { n: number; unit: string }[];
    if (alpha && alpha.unit !== '' && alpha.unit !== '%') return null;
    if (fn[1].startsWith('rgb')) {
      if ([a, b, c].some((x) => x.unit !== '' && x.unit !== '%')) return null;
      const byte = (x: { n: number; unit: string }) => (x.unit === '%' ? (x.n / 100) * 255 : x.n);
      return rgbToHex({ r: byte(a), g: byte(b), b: byte(c) });
    }
    const turn = { '': 1, deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 }[a.unit];
    if (turn === undefined || [b, c].some((x) => x.unit !== '' && x.unit !== '%')) return null;
    return rgbToHex(hslToRgb((((a.n * turn) % 360) + 360) % 360, clamp(b.n, 0, 100) / 100, clamp(c.n, 0, 100) / 100));
  }
  return /^[a-z]+$/.test(s) ? (named?.(s) ?? null) : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt((parseHex(hex) ?? '#000000').slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const byte = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: Math.round(h) % 360, s: Math.round(max === 0 ? 0 : (d / max) * 100), v: Math.round((max / 255) * 100) };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const [r, g, b] = (
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  ) as [number, number, number];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/**
 * The wheel model: `dx`/`dy` are offsets from the centre in fractions of the
 * radius (canvas y grows downward), the angle gives the hue and the distance
 * the saturation, clamped at the rim.
 */
export function wheelToHsv(dx: number, dy: number): { h: number; s: number } {
  const h = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
  return { h: h % 360, s: Math.round(clamp(Math.hypot(dx, dy), 0, 1) * 100) };
}
