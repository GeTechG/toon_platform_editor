/**
 * Pure audio-track helpers: what a file may be, and how a decoded signal
 * lines up with the frame strip. DOM-free so it runs under bun test — the
 * decoding itself (`AudioContext.decodeAudioData`) lives in the UI.
 */

/** Types the reference's «нота» button accepts. */
export const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav'] as const;

/** Size cap: a track rides in the draft and in the publish payload. */
export const AUDIO_MAX_BYTES = 10 * 1024 * 1024;

/** Complaint about a picked file, or null if it may be loaded. */
export function checkAudioFile(file: { type: string; size: number }): string | null {
  if (!(AUDIO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'Нужен звуковой файл: mp3, ogg или wav';
  }
  if (file.size > AUDIO_MAX_BYTES) {
    return `Файл тяжелее ${AUDIO_MAX_BYTES / 1024 / 1024} МБ`;
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
