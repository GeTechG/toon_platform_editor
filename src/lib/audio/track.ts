/**
 * Pure audio-track helpers: what a file may be, and how a decoded signal
 * lines up with the frame strip. DOM-free so it runs under bun test — the
 * decoding itself (`AudioContext.decodeAudioData`) lives in the UI.
 */
// The core, not `../i18n`: the share player borrows the maths below, and the
// catalogue that import registers is the whole studio's vocabulary. Whoever
// checks a file is a studio surface, which has already registered it.
import { translator } from '../i18n-core';

const t = translator('editor');

/** Types the «нота» button suggests; anything `audio/*` is accepted. */
export const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav'] as const;

/**
 * Size cap: a track rides in the draft, and past this point the record itself
 * is «слишком большой» for IndexedDB on a phone. The reference has no cap of
 * its own — the browser's decoder is the only judge of a file.
 */
export const AUDIO_MAX_BYTES = 70 * 1024 * 1024;

/**
 * Longest name or author the API stores (`MAX_CREDIT_CHARS` in
 * `services/api/src/publications/web.rs`). Past it the upload is refused and
 * the publication goes out silent, so the editor never holds a longer one.
 */
export const AUDIO_MAX_CREDIT = 120;

/**
 * What the API keeps of a published soundtrack (`MAX_AUDIO_BYTES` and
 * `audio_type` in `services/api/src/publications/web.rs`): 10 MB of mp3, ogg
 * or wav. The editor holds more than that; the owner's call is to say so,
 * not to raise the server's cap. The platform page reads the same number.
 */
export const PUBLISH_AUDIO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Why a track would not go out with the toon, from its first 12 bytes and its
 * size — the server's own sniff, byte for byte — or null if it would.
 */
export function publishProblem(head: Uint8Array, size: number): 'format' | 'size' | null {
  if (size > PUBLISH_AUDIO_MAX_BYTES) return 'size';
  if (head.length < 12) return 'format';
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  const mp3 = ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  const ogg = ascii(0, 4) === 'OggS';
  const wav = ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
  return mp3 || ogg || wav ? null : 'format';
}

/**
 * Credits for a freshly loaded file: its own ID3 tags first, then what the
 * caller offers — minus an artist that only the previous file's tags put in
 * the field, which belongs to that song and not to this one.
 */
export function trackCredits(
  tags: { title: string; artist: string },
  name: string,
  author: string,
  previousTagArtist = '',
): { name: string; author: string } {
  const offered = author && author === previousTagArtist ? '' : author;
  return {
    name: (tags.title || name).slice(0, AUDIO_MAX_CREDIT),
    author: (tags.artist || offered).slice(0, AUDIO_MAX_CREDIT),
  };
}

/**
 * Sound by its type, or by its name when the system types it wrong: Firefox
 * and Windows call an .ogg `video/ogg`, and a file the system does not know
 * comes with no type at all. The decoder is the real judge either way.
 */
const AUDIO_EXTENSIONS = /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac|weba)$/i;

export function isAudioFile(file: { type: string; name?: string }): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name ?? '');
}

/**
 * The type each extension stands for when asked of `canPlayType`. The owner's
 * call after the fifteenth audit: the studio takes only sound this browser
 * plays — an ogg on Safari 16 decoded for its wave, then played nothing and
 * went out of an export silent.
 */
const EXTENSION_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg; codecs=opus',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  weba: 'audio/webm',
};

/**
 * Whether this browser's `<audio>` says it may play the file. A type it does
 * not recognise (`audio/x-m4a`, Firefox's `video/ogg`) gets a second chance by
 * the extension; a «maybe» counts, and the decoder is still asked after.
 */
export function playableHere(file: { type: string; name?: string }, canPlayType: (type: string) => string): boolean {
  const ext = /\.([^.]+)$/.exec(file.name ?? '')?.[1].toLowerCase() ?? '';
  const types = [file.type.startsWith('audio/') ? file.type : '', EXTENSION_TYPES[ext] ?? ''];
  return types.some((type) => type !== '' && canPlayType(type) !== '');
}

/** The picker's `accept`: the extensions this browser plays, `audio/*` if it names none. */
export function playableAccept(canPlayType: (type: string) => string): string {
  const exts = Object.keys(EXTENSION_TYPES).filter((ext) => canPlayType(EXTENSION_TYPES[ext]) !== '');
  return exts.length ? exts.map((ext) => `.${ext}`).join(',') : 'audio/*';
}

/**
 * Which of the three formats the site publishes this browser plays — what the
 * plate names. Safari 16 plays no ogg, and «mp3, ogg или wav» offered it.
 */
export function playableFormats(canPlayType: (type: string) => string): string[] {
  return ['mp3', 'ogg', 'wav'].filter((ext) => canPlayType(EXTENSION_TYPES[ext]) !== '');
}

/**
 * Lets a press unlock the element without sounding it: iOS allows `play()`
 * only inside a gesture, and a press on a frame past a tied track's end had
 * none to spare — the next lap came round silent. Paused at once, so nothing
 * is heard; the `AbortError` that pause earns is expected.
 */
export function unlockElement(element: { play(): Promise<unknown>; pause(): unknown }): void {
  void element.play().catch(() => {});
  element.pause();
}

/** Complaint about a picked file, or null if it may be loaded. */
export function checkAudioFile(file: { type: string; size: number; name?: string }): string | null {
  if (!isAudioFile(file)) {
    return t('audio.need_file');
  }
  if (file.size > AUDIO_MAX_BYTES) {
    return t('audio.too_big', { limit: AUDIO_MAX_BYTES / 1024 / 1024 });
  }
  return null;
}

/**
 * What a refused `play()` means for the person. Only `NotAllowedError` is the
 * browser holding the sound back until a press; `AbortError` is a pause or a
 * new track cutting the start short, which is no failure at all; anything else
 * is an element that will not play this file.
 */
export function playRefusal(err: unknown): 'blocked' | 'unplayable' | null {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'NotAllowedError' ? 'blocked' : name === 'AbortError' ? null : 'unplayable';
}

/** When frame `index` is shown, in seconds from the start of the track. */
export function timeForFrame(index: number, fps: number): number {
  return index / fps;
}

/** How long one pass of the animation lasts, in seconds. */
export function loopSeconds(frames: number, fps: number): number {
  return frames / fps;
}

/**
 * Whether a tied track is due back at its start. Tied, the animation is the
 * timeline and the track is pinned to its first frame, so the track restarts
 * with the animation rather than running on past it — frame 0 always means
 * second 0 of the track, however long the track is.
 */
export function trackShouldRestart(currentTime: number, frames: number, fps: number): boolean {
  return currentTime >= loopSeconds(frames, fps);
}

/**
 * Where a tied track stands when frame `index` is shown, or `null` past its
 * end — there is nothing to play there.
 *
 * Tied means one frame maps to one point of the track. A track shorter than
 * the animation therefore sounds once and stops, starting again when the
 * animation comes back round to its first frame. The reference repeats it by
 * the modulo of its length instead (`bundle:8429-8447`), which plays the same
 * second of the track on several frames and turns a three-second line of
 * dialogue into a chant; looping under the frames is what the *untied* mode is
 * for. Deliberate departure from toonio.ru — see the `audio-track` spec.
 */
export function trackTimeFor(index: number, fps: number, duration: number): number | null {
  const at = timeForFrame(index, fps);
  return duration > 0 && at >= duration ? null : at;
}

/** The frame holding second `time`. */
export function frameForTime(time: number, fps: number): number {
  return Math.floor(time * fps);
}

/**
 * One bar per frame: the loudest sample in that frame's slice of the track.
 * Peaks are keyed to fps, so changing 12 → 24 stretches the wave across
 * twice as many frames without re-decoding.
 *
 * ponytail: linear scan over every sample. A 10 MB mp3 is ~5 M samples —
 * a few ms once per load. Downsample first if longer tracks ever land.
 */
export function waveformPeaks(samples: Float32Array, sampleRate: number, fps: number): Float32Array {
  const perFrame = sampleRate / fps;
  const peaks = new Float32Array(Math.ceil(samples.length / perFrame));
  for (let i = 0; i < samples.length; i++) {
    const frame = Math.floor(i / perFrame);
    const level = Math.abs(samples[i]);
    if (level > peaks[frame]) {
      peaks[frame] = level;
    }
  }
  return peaks;
}

/**
 * Resolution the decoded track is kept at: 200 levels per second is finer
 * than any frame rate the editor allows, so the strip's bars are recomputed
 * from it when fps changes instead of re-decoding the file — and the raw
 * samples (tens of MB) are dropped right after the decode.
 */
export const ENVELOPE_RATE = 200;

/** `AudioBuffer`, as much of it as the envelope needs. */
export interface DecodedAudio {
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * Loudness envelope of a decoded track at `ENVELOPE_RATE`: the loudest
 * sample across every channel, so a track mixed to one side still draws.
 * Feed it back to `waveformPeaks` at `ENVELOPE_RATE` to get bars per frame.
 */
export function trackEnvelope(buffer: DecodedAudio): Float32Array {
  let envelope: Float32Array = new Float32Array(0);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const peaks = waveformPeaks(buffer.getChannelData(channel), buffer.sampleRate, ENVELOPE_RATE);
    if (channel === 0) {
      envelope = peaks;
      continue;
    }
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i] > envelope[i]) {
        envelope[i] = peaks[i];
      }
    }
  }
  return envelope;
}

/**
 * The reference's wave (`bundle:8706-8740`): every frame is cut into
 * `barsPerFrame` windows, each bar is the mean level of its window, and the
 * whole track is normalised by its loudest bar — so a quiet recording still
 * draws a full wave.
 */
export function waveformBars(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
  barsPerFrame: number,
): Float32Array {
  const perBar = sampleRate / fps / Math.max(1, barsPerFrame);
  const bars = new Float32Array(Math.ceil(samples.length / perBar));
  const counts = new Float32Array(bars.length);
  for (let i = 0; i < samples.length; i++) {
    const bar = Math.floor(i / perBar);
    bars[bar] += Math.abs(samples[i]);
    counts[bar]++;
  }
  let loudest = 0;
  for (let i = 0; i < bars.length; i++) {
    // Finer bars than levels (the envelope keeps 200 a second, a 48 px cell
    // at 12 fps asks for 288): a bar that holds no level takes the one it
    // starts in, or a steady tone draws as a comb.
    bars[i] = counts[i] ? bars[i] / counts[i] : Math.abs(samples[Math.floor(i * perBar)] ?? 0);
    if (bars[i] > loudest) {
      loudest = bars[i];
    }
  }
  if (loudest > 0) {
    for (let i = 0; i < bars.length; i++) {
      bars[i] /= loudest;
    }
  }
  return bars;
}

/**
 * Artist and title out of an ID3v2.3/2.4 tag — `TPE1` and `TIT2`, in the
 * three text encodings anything in the wild uses. Untrusted input: every
 * length comes out of the file, so a frame that claims more than the buffer
 * holds ends the read instead of throwing. No tag means empty strings, which
 * is exactly what the reference falls back on.
 */
export function readId3(buffer: ArrayBuffer): { artist: string; title: string } {
  let bytes: Uint8Array = new Uint8Array(buffer);
  const none = { artist: '', title: '' };
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return none;
  }
  const version = bytes[3];
  if (version !== 3 && version !== 4) {
    return none;
  }
  let end = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
  // v2.3 unsynchronises the whole tag (an 0x00 after every 0xFF, so no
  // player takes it for audio); the frame sizes count the bytes before that.
  if (version === 3 && bytes[5] & 0x80) {
    const tag = resync(bytes.subarray(10, end));
    const whole = new Uint8Array(10 + tag.length);
    whole.set(bytes.subarray(0, 10));
    whole.set(tag, 10);
    bytes = whole;
    end = bytes.length;
  }
  const found = { ...none };
  let at = 10;
  // An extended header sits before the frames: v2.4 counts itself in its
  // synchsafe size, v2.3 stores a plain size that leaves its own four out.
  if (bytes[5] & 0x40) {
    at += version === 4 ? synchsafe(bytes, 10) : 4 + ((bytes[10] << 24) | (bytes[11] << 16) | (bytes[12] << 8) | bytes[13]);
  }
  while (at + 10 <= end) {
    const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    if (id === '\0\0\0\0') {
      break; // padding
    }
    // v2.4 sizes are synchsafe; v2.3 stores a plain 32-bit length.
    const size = version === 4
      ? synchsafe(bytes, at + 4)
      : (bytes[at + 4] << 24) | (bytes[at + 5] << 16) | (bytes[at + 6] << 8) | bytes[at + 7];
    const from = at + 10;
    if (size <= 0 || from + size > end) {
      break;
    }
    if (id === 'TPE1' || id === 'TIT2') {
      // v2.4 flags it per frame, with the data length in front when it does.
      const flags = version === 4 ? bytes[at + 9] : 0;
      let data = bytes.subarray(from + (flags & 0x01 ? 4 : 0), from + size);
      if (flags & 0x02) data = resync(data);
      const text = decodeText(data);
      if (id === 'TPE1') {
        found.artist = text;
      } else {
        found.title = text;
      }
    }
    at = from + size;
  }
  return found;
}

/** ID3 unsynchronisation undone: the 0x00 written after every 0xFF goes. */
function resync(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[n++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0) i++;
  }
  return out.subarray(0, n);
}

/** Four bytes of seven bits each — ID3's way of never spelling 0xFF. */
function synchsafe(bytes: Uint8Array, at: number): number {
  return ((bytes[at] & 127) << 21) | ((bytes[at + 1] & 127) << 14) | ((bytes[at + 2] & 127) << 7) | (bytes[at + 3] & 127);
}

/**
 * An ID3 text frame: one encoding byte, then the string. UTF-16 is 2 without a
 * BOM (big-endian) or 1 with one of either order; `TextDecoder` does not
 * switch order on a BOM, so the order is read here. v2.4 lists several values
 * split by NUL; they read as a list, since a NUL inside a credit is one the
 * server's database will not store.
 */
function decodeText(frame: Uint8Array): string {
  const body = frame.subarray(1);
  const bigEndian = frame[0] === 2 || (frame[0] === 1 && body[0] === 0xfe && body[1] === 0xff);
  const label = bigEndian ? 'utf-16be' : frame[0] === 1 ? 'utf-16le' : frame[0] === 3 ? 'utf-8' : 'latin1';
  // Encoding 0 is latin1 on paper, but Russian tags write UTF-8 there (or
  // cp1251). UTF-8 is tried strictly; anything else is shown as latin1 reads
  // it — a cp1251 guess would garble the Western tags that are latin1.
  if (label === 'latin1') {
    try {
      return values(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch {
      // not UTF-8: latin1 below
    }
  }
  try {
    return values(new TextDecoder(label).decode(body));
  } catch {
    return '';
  }
}

function values(text: string): string {
  return text.split('\0').map((v) => v.trim()).filter(Boolean).join(', ');
}
