/**
 * Pure animated-WebP container assembler: DOM-free, so it runs under bun test
 * and could run in a worker. It does NOT encode pixels — the browser does that
 * natively (`canvas.toBlob('image/webp')`), producing one WebP still per frame.
 * Here we lift each still's image bitstream and stitch the stills into a single
 * animated WebP (RIFF/`WEBP` = VP8X + ANIM + one ANMF per frame), which loops in
 * a plain `<img>`. Also holds the pure preview-sizing math.
 *
 * Container layout per the WebP spec:
 *   https://developers.google.com/speed/webp/docs/riff_container
 */

/** One encoded WebP still (a whole RIFF/`WEBP` file) plus its pixel size. */
export interface WebpStill {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface AnimateOptions {
  fps: number;
  /** Loop count; 0 (default) means forever. */
  loop?: number;
}

/** Image sub-chunks a still may carry that belong inside an ANMF frame. */
const FRAME_CHUNKS = new Set(['VP8 ', 'VP8L', 'ALPH']);

/**
 * Stitch per-frame WebP stills into one looping animated WebP. All frames are
 * assumed the same size (the caller renders them so); the first frame's size is
 * the canvas size. Frame duration is derived from `fps`.
 */
export function assembleAnimatedWebp(
  frames: WebpStill[],
  { fps, loop = 0 }: AnimateOptions,
): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) {
    throw new Error('animated webp needs at least one frame');
  }
  const { width, height } = frames[0];
  const durationMs = Math.max(1, Math.round(1000 / fps));

  const vp8x = chunk('VP8X', [
    0x02, // flags: Animation bit set (opaque frames → no alpha/ICC/EXIF/XMP)
    0, 0, 0, // reserved
    ...u24le(width - 1),
    ...u24le(height - 1),
  ]);
  const anim = chunk('ANIM', [0, 0, 0, 0, ...u16le(loop)]); // bg color (unused) + loop count
  const anmfs = frames.map((f) => anmf(f, durationMs));

  const body = concat([vp8x, anim, ...anmfs]);
  return concat([
    new Uint8Array([...ascii('RIFF'), ...u32le(4 + body.length)]),
    new Uint8Array(ascii('WEBP')),
    body,
  ]);
}

/** One ANMF chunk: 16-byte frame header + the still's image sub-chunks. */
function anmf(frame: WebpStill, durationMs: number): Uint8Array {
  const header = [
    ...u24le(0), // frame x (2px units)
    ...u24le(0), // frame y
    ...u24le(frame.width - 1),
    ...u24le(frame.height - 1),
    ...u24le(durationMs),
    0, // flags: no blending tricks, no dispose
  ];
  return chunk('ANMF', concat([new Uint8Array(header), imageChunks(frame.data)]));
}

/**
 * Copy out a still's image sub-chunks (VP8/VP8L/ALPH), header + payload + pad.
 * With `set`, not spread: `push(...bytes)` passes every byte as an argument,
 * and a still past a hundred-odd kilobytes overflowed the stack in Chrome.
 */
function imageChunks(still: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [];
  let at = 12; // skip RIFF header + 'WEBP'
  while (at + 8 <= still.length) {
    const tag = String.fromCharCode(...still.subarray(at, at + 4));
    const size = (still[at + 4] | (still[at + 5] << 8) | (still[at + 6] << 16) | (still[at + 7] << 24)) >>> 0;
    const end = at + 8 + size + (size % 2); // include RIFF even-padding
    if (FRAME_CHUNKS.has(tag)) {
      out.push(still.subarray(at, Math.min(end, still.length)));
    }
    at = end;
  }
  return concat(out);
}

/** Frame count for a preview: at most `maxFrames`, and at most `maxSeconds` worth. */
export function previewFrameBudget(
  fps: number,
  { maxFrames = 50, maxSeconds = 6 }: { maxFrames?: number; maxSeconds?: number } = {},
): number {
  return Math.min(maxFrames, Math.ceil(maxSeconds * fps));
}

/** Shrink `width`×`height` so its long side is ≤ `maxLongSide`, keeping aspect. */
export function downscaleSize(
  width: number,
  height: number,
  maxLongSide: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxLongSide) {
    return { width, height };
  }
  const scale = maxLongSide / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** One way to make a preview: its long side in px and the still quality (0–1). */
export interface PreviewRung {
  side: number;
  quality: number;
}

/**
 * How a preview is made, best first. Quality 1 is lossless where the browser
 * has it (Chromium): line art keeps its exact colours and edges, which the
 * lossy encoder's halved colour resolution smeared — a thin coloured line came
 * out duller and fringed. 512 px, because a card is drawn up to ~320 CSS px
 * wide and a dense screen doubles that. Each rung down trades some of that for
 * weight, the old 384 px at 0.75 last.
 */
export const PREVIEW_RUNGS: readonly PreviewRung[] = [
  { side: 512, quality: 1 },
  { side: 512, quality: 0.92 },
  { side: 384, quality: 0.92 },
  { side: 384, quality: 0.75 },
];

/**
 * What a whole preview may weigh. A page of the gallery is 24 of them, so
 * this, not the server's 1 MB cap, is what a phone pays for. Measured
 * 2026-10-06 on published toons: a lossless 512 px frame is 15–35 KB, so a
 * short toon stays lossless and a 50-frame one steps down.
 */
export const PREVIEW_BUDGET_BYTES = 700 * 1024;

/**
 * Build with each rung in turn, best first, and return the first result that
 * weighs no more than `budget`; if none does, the last rung's — a heavy
 * preview still beats none.
 */
export async function firstThatFits<R>(
  rungs: readonly R[],
  budget: number,
  build: (rung: R) => Promise<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  let built = new Uint8Array(0);
  for (const rung of rungs) {
    built = await build(rung);
    if (built.length <= budget) {
      break;
    }
  }
  return built;
}

// --- byte helpers ---

/** A RIFF chunk: FourCC + uint32-LE size + payload, even-padded. */
function chunk(fourcc: string, payload: number[] | Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length + (payload.length % 2));
  out.set(ascii(fourcc), 0);
  out.set(u32le(payload.length), 4);
  out.set(payload, 8);
  return out;
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const u16le = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32le = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
