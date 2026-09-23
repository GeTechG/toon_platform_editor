/**
 * Pure audio-track helpers: what a file may be, and how a decoded signal
 * lines up with the frame strip. DOM-free so it runs under bun test — the
 * decoding itself (`AudioContext.decodeAudioData`) lives in the UI.
 */
import { t } from '../i18n';

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

/** Complaint about a picked file, or null if it may be loaded. */
export function checkAudioFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('audio/')) {
    return t('audio.need_file');
  }
  if (file.size > AUDIO_MAX_BYTES) {
    return t('audio.too_big', { limit: AUDIO_MAX_BYTES / 1024 / 1024 });
  }
  return null;
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
    bars[i] = counts[i] ? bars[i] / counts[i] : 0;
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
  const bytes = new Uint8Array(buffer);
  const none = { artist: '', title: '' };
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return none;
  }
  const version = bytes[3];
  if (version !== 3 && version !== 4) {
    return none;
  }
  const end = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
  const found = { ...none };
  let at = 10;
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
      const text = decodeText(bytes.subarray(from, from + size));
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

/** Four bytes of seven bits each — ID3's way of never spelling 0xFF. */
function synchsafe(bytes: Uint8Array, at: number): number {
  return ((bytes[at] & 127) << 21) | ((bytes[at + 1] & 127) << 14) | ((bytes[at + 2] & 127) << 7) | (bytes[at + 3] & 127);
}

/** An ID3 text frame: one encoding byte, then the string. */
function decodeText(frame: Uint8Array): string {
  const body = frame.subarray(1);
  const label = frame[0] === 1 || frame[0] === 2 ? 'utf-16' : frame[0] === 3 ? 'utf-8' : 'latin1';
  try {
    return new TextDecoder(label).decode(body).replace(/\0+$/, '');
  } catch {
    return '';
  }
}
