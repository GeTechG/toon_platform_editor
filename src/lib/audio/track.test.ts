import { describe, expect, test } from 'bun:test';
import {
  AUDIO_MAX_BYTES,
  AUDIO_MIME_TYPES,
  checkAudioFile,
  ENVELOPE_RATE,
  frameForTime,
  timeForFrame,
  trackEnvelope,
  waveformPeaks,
} from './track';

/** Mono signal: `n` samples, amplitude from `amp(i)`. */
function signal(n: number, amp: (i: number) => number): Float32Array {
  return Float32Array.from({ length: n }, (_, i) => amp(i));
}

describe('checkAudioFile', () => {
  test('accepts an mp3 under the limit', () => {
    expect(checkAudioFile({ type: 'audio/mpeg', size: 1024 })).toBeNull();
  });

  test('rejects a file over the size limit', () => {
    expect(checkAudioFile({ type: 'audio/mpeg', size: AUDIO_MAX_BYTES + 1 })).toMatch(/МБ/);
  });

  test('rejects a type that is not audio', () => {
    expect(checkAudioFile({ type: 'video/mp4', size: 1024 })).toMatch(/mp3/);
  });

  test('accepts every advertised type', () => {
    for (const type of AUDIO_MIME_TYPES) {
      expect(checkAudioFile({ type, size: 1 })).toBeNull();
    }
  });
});

describe('waveformPeaks', () => {
  test('one peak per frame: max absolute sample in the frame window', () => {
    // 4 frames at 12 fps over 8000 Hz → 666.67 samples per frame.
    const samples = signal(8000, (i) => (i < 4000 ? 0.5 : -1));
    const peaks = waveformPeaks(samples, 8000, 12);
    expect(peaks.length).toBe(12);
    expect(peaks[0]).toBeCloseTo(0.5, 5);
    expect(peaks[11]).toBeCloseTo(1, 5);
  });

  test('doubling fps doubles the number of peaks — the wave stretches over frames', () => {
    const samples = signal(4800, () => 0.25);
    expect(waveformPeaks(samples, 4800, 12).length).toBe(12);
    expect(waveformPeaks(samples, 4800, 24).length).toBe(24);
  });

  test('a partial last frame still gets a peak', () => {
    const samples = signal(120, () => 1);
    // 100 samples per frame at 12 fps / 1200 Hz → one full frame plus a fifth.
    expect(waveformPeaks(samples, 1200, 12).length).toBe(2);
  });

  test('no samples → no peaks', () => {
    expect(waveformPeaks(new Float32Array(0), 8000, 12).length).toBe(0);
  });
});

describe('frame ↔ time', () => {
  test('playback from frame 24 at 12 fps starts the sound at 2 s', () => {
    expect(timeForFrame(24, 12)).toBeCloseTo(2, 5);
  });

  test('a time maps back to the frame holding it', () => {
    expect(frameForTime(2, 12)).toBe(24);
    expect(frameForTime(2.04, 12)).toBe(24);
  });
});

describe('trackEnvelope', () => {
  /** AudioBuffer-shaped stand-in. */
  const buffer = (channels: number[][], sampleRate: number) => ({
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (i: number) => Float32Array.from(channels[i]),
  });

  test('one envelope sample per 1/ENVELOPE_RATE second', () => {
    const one = Array(ENVELOPE_RATE * 2).fill(0.5); // 2 s at ENVELOPE_RATE Hz
    expect(trackEnvelope(buffer([one], ENVELOPE_RATE)).length).toBe(ENVELOPE_RATE * 2);
  });

  test('takes the loudest of all channels, so a one-sided track still shows', () => {
    const env = trackEnvelope(buffer([[0, 0], [0, 1]], ENVELOPE_RATE));
    expect(Math.max(...env)).toBeCloseTo(1, 5);
  });

  test('an envelope feeds waveformPeaks as if it were a signal at ENVELOPE_RATE', () => {
    const env = trackEnvelope(buffer([Array(ENVELOPE_RATE).fill(1)], ENVELOPE_RATE));
    expect(waveformPeaks(env, ENVELOPE_RATE, 12).length).toBe(12);
    expect(waveformPeaks(env, ENVELOPE_RATE, 24).length).toBe(24);
  });
});
