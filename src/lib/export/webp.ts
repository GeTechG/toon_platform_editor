/**
 * Pure animated-WebP container assembler: DOM-free, so it runs under bun test
 * and could run in a worker. Pixels are encoded by the browser natively
 * (`canvas.toBlob('image/webp')`), one WebP still per frame — or, where it
 * cannot (Safari hands back a PNG), by libwebp in WASM (`webpStill`).
 * Here we lift each still's image bitstream and stitch the stills into a single
 * animated WebP (RIFF/`WEBP` = VP8X + ANIM + one ANMF per frame), which loops in
 * a plain `<img>`. Also holds the pure preview-sizing math.
 *
 * Container layout per the WebP spec:
 *   https://developers.google.com/speed/webp/docs/riff_container
 */

import encodeWebp from '@jsquash/webp/encode';

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
  /** Ticks each frame stays on screen (the document's `holds`); one each without. */
  holds?: readonly number[];
}

/** Image sub-chunks a still may carry that belong inside an ANMF frame. */
const FRAME_CHUNKS = new Set(['VP8 ', 'VP8L', 'ALPH']);

/** Whether a still is written without loss: a VP8L chunk, not VP8 with or
 * without its VP8X and ALPH around it. */
function isLossless(still: Uint8Array): boolean {
  const view = new DataView(still.buffer, still.byteOffset, still.byteLength);
  for (let at = 12; at + 8 <= still.length; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) & 1)) {
    const tag = String.fromCharCode(still[at], still[at + 1], still[at + 2], still[at + 3]);
    if (tag === 'VP8L') return true;
    if (tag === 'VP8 ') return false;
  }
  return false;
}

/**
 * The bytes of one WebP still: the browser's own `toBlob('image/webp')`
 * result when it is one, else `pixels` encoded by libwebp at the same
 * `quality` (1 is lossless, as `toBlob` takes it).
 */
export async function webpStill(
  native: Blob | null,
  pixels: () => Pick<ImageData, 'data' | 'width' | 'height'>,
  quality: number,
): Promise<Uint8Array> {
  if (native?.type === 'image/webp') {
    const made = new Uint8Array(await native.arrayBuffer());
    // Asked to lose nothing, not every browser does: only a lossless one stays.
    if (quality < 1 || isLossless(made)) {
      return made;
    }
  }
  const options = quality >= 1 ? { lossless: 1 } : { quality: quality * 100 };
  return new Uint8Array(await encodeWebp(pixels() as ImageData, options));
}

/**
 * Stitch per-frame WebP stills into one looping animated WebP. All frames are
 * assumed the same size (the caller renders them so); the first frame's size is
 * the canvas size. Frame duration is derived from `fps` and the frame's hold.
 */
export function assembleAnimatedWebp(
  frames: WebpStill[],
  { fps, loop = 0, holds }: AnimateOptions,
): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) {
    throw new Error('animated webp needs at least one frame');
  }
  const { width, height } = frames[0];
  const durationMs = (hold = 1) => Math.max(1, Math.round((1000 * hold) / fps));

  const vp8x = chunk('VP8X', [
    0x02, // flags: Animation bit set (opaque frames → no alpha/ICC/EXIF/XMP)
    0, 0, 0, // reserved
    ...u24le(width - 1),
    ...u24le(height - 1),
  ]);
  const anim = chunk('ANIM', [0, 0, 0, 0, ...u16le(loop)]); // bg color (unused) + loop count
  const anmfs = frames.map((f, i) => anmf(f, durationMs(holds?.[i])));

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

/**
 * Frame count for a preview: at most `maxFrames`, and at most `maxSeconds`
 * worth — counted in ticks, so a held frame spends its whole pause.
 */
export function previewFrameBudget(
  fps: number,
  { maxFrames = 50, maxSeconds = 6, holds }: { maxFrames?: number; maxSeconds?: number; holds?: readonly number[] } = {},
): number {
  const ticks = Math.ceil(maxSeconds * fps);
  if (!holds) {
    return Math.min(maxFrames, ticks);
  }
  // The frames that start inside the time cap.
  let count = 0;
  for (let start = 0; count < Math.min(maxFrames, holds.length) && start < ticks; count++) {
    start += holds[count];
  }
  return count;
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
  /** The most it may weigh to go out at this rung. */
  budget: number;
}

/**
 * What may be sent as it is, whatever its weight: the server packs it and lets
 * go of what it must to keep `PREVIEW_BUDGET_BYTES` (`services/api/src/pictures.rs`),
 * better than here, since it can say each frame by what changed. The rest of
 * the rungs are for what is over even this, which the server would turn down.
 */
export const PREVIEW_UPLOAD_BYTES = 8 * 1024 * 1024;

/** What a whole preview may weigh once made here, and not by the server. */
export const PREVIEW_BUDGET_BYTES = 700 * 1024;

/**
 * How a preview is made, best first. Quality 1 is lossless: line art keeps its
 * exact colours and edges, which the lossy encoder's halved colour resolution
 * smeared. 512 px, because a card is drawn up to ~320 CSS px wide and a dense
 * screen doubles that. Each rung down trades some of that for weight.
 */
export const PREVIEW_RUNGS: readonly PreviewRung[] = [
  { side: 512, quality: 1, budget: PREVIEW_UPLOAD_BYTES },
  { side: 512, quality: 0.92, budget: PREVIEW_BUDGET_BYTES },
  { side: 384, quality: 0.92, budget: PREVIEW_BUDGET_BYTES },
  { side: 384, quality: 0.75, budget: PREVIEW_BUDGET_BYTES },
];

/**
 * Build with each rung in turn, best first, and return the first result that
 * weighs no more than its `budget`; if none does, the last rung's — a heavy
 * preview still beats none.
 */
export async function firstThatFits<R>(
  rungs: readonly R[],
  budget: (rung: R) => number,
  build: (rung: R) => Promise<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  let built = new Uint8Array(0);
  for (const rung of rungs) {
    built = await build(rung);
    if (built.length <= budget(rung)) {
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
