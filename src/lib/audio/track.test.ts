import { describe, expect, test } from 'bun:test';
// The studio's catalogue, which every surface that checks a file has loaded.
import '../i18n';
import {
  AUDIO_MAX_BYTES,
  AUDIO_MAX_CREDIT,
  trackCredits,
  AUDIO_MIME_TYPES,
  checkAudioFile,
  ENVELOPE_RATE,
  frameForTime,
  loopSeconds,
  readId3,
  timeForFrame,
  trackTimeFor,
  trackEnvelope,
  trackShouldRestart,
  waveformBars,
  waveformPeaks,
  publishProblem,
  PUBLISH_AUDIO_MAX_BYTES,
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
    expect(checkAudioFile({ type: 'video/mp4', size: 1024 })).toMatch(/звук/);
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

describe('loopSeconds', () => {
  test('the animation\'s own length is where a tied track restarts', () => {
    expect(loopSeconds(4, 12)).toBeCloseTo(1 / 3, 5);
    expect(loopSeconds(24, 12)).toBe(2);
  });

  test('a tied track is due to restart once it passes that point', () => {
    // 4 frames at 12 fps: the loop is a third of a second long.
    expect(trackShouldRestart(0.3, 4, 12)).toBe(false);
    expect(trackShouldRestart(0.34, 4, 12)).toBe(true);
    // Exactly on the boundary is the next loop's first frame.
    expect(trackShouldRestart(1 / 3, 4, 12)).toBe(true);
  });

  test('a track under way inside the loop is left alone', () => {
    expect(trackShouldRestart(0, 4, 12)).toBe(false);
    expect(trackShouldRestart(1.9, 24, 12)).toBe(false);
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

describe('any audio file the browser might play', () => {
  test('accepts a type outside the known list, as long as it is audio', () => {
    expect(checkAudioFile({ type: 'audio/flac', size: 1024 })).toBeNull();
    expect(checkAudioFile({ type: 'audio/x-unknown', size: 1024 })).toBeNull();
  });

  test('still refuses what is not audio at all', () => {
    expect(checkAudioFile({ type: 'image/png', size: 1024 })).toBeString();
    expect(checkAudioFile({ type: '', size: 1024 })).toBeString();
  });

  test('the cap is the size a draft record can still carry', () => {
    expect(AUDIO_MAX_BYTES).toBe(70 * 1024 * 1024);
  });
});

describe('trackTimeFor: tied means one frame, one point of the track', () => {
  test('the position is the frame\'s own time', () => {
    expect(trackTimeFor(24, 12, 10)).toBeCloseTo(2, 5);
    expect(trackTimeFor(0, 12, 1)).toBe(0);
    expect(trackTimeFor(11, 12, 1)).toBeCloseTo(11 / 12, 5);
  });

  test('past the end of the track there is nothing to play — silence, not a repeat', () => {
    // 36 frames at 12 fps over a one-second track: the track sounds through
    // frame 11 and the rest of the pass is quiet, until frame 0 comes round.
    expect(trackTimeFor(12, 12, 1)).toBeNull();
    expect(trackTimeFor(30, 12, 1)).toBeNull();
  });

  test('an unknown duration is not a reason to stay quiet', () => {
    expect(trackTimeFor(24, 12, 0)).toBeCloseTo(2, 5);
  });
});

describe('waveformBars', () => {
  test('a bar is the mean level of its window, normalised by the loudest', () => {
    // 100 Hz, 2 fps, one bar per frame → a 50-sample window per bar.
    const samples = signal(100, (i) => (i < 50 ? 1 : 0.25));
    const bars = waveformBars(samples, 100, 2, 1);
    expect(bars.length).toBe(2);
    expect(bars[0]).toBeCloseTo(1, 5);
    expect(bars[1]).toBeCloseTo(0.25, 5);
  });

  test('a full sine reads as its mean magnitude, not its peak', () => {
    const rate = 1000;
    const samples = signal(rate, (i) => Math.sin((2 * Math.PI * i) / rate));
    // One second at 2 fps, two bars per frame → four quarter-second windows,
    // each holding a quarter of the sine; all four have the same mean.
    const bars = waveformBars(samples, rate, 2, 2);
    expect(bars.length).toBe(4);
    for (const bar of bars) {
      expect(bar).toBeCloseTo(1, 1); // discrete windows differ a fraction of a percent
    }
  });

  test('more bars per frame cuts the same track into more windows', () => {
    const samples = signal(1200, () => 0.5);
    expect(waveformBars(samples, 1200, 12, 1).length).toBe(12);
    expect(waveformBars(samples, 1200, 12, 4).length).toBe(48);
  });

  test('silence and no samples produce no false bars', () => {
    expect(waveformBars(new Float32Array(0), 8000, 12, 2).length).toBe(0);
    expect([...waveformBars(signal(100, () => 0), 100, 2, 1)]).toEqual([0, 0]);
  });
});

describe('readId3', () => {
  /** Builds an ID3v2 tag holding the given frames, then a byte of "audio". */
  function tag(version: 3 | 4, frames: [string, number, string][]): ArrayBuffer {
    const body: number[] = [];
    for (const [id, encoding, text] of frames) {
      const data = [encoding, ...textBytes(encoding, text)];
      const size = version === 4
        ? [(data.length >> 21) & 127, (data.length >> 14) & 127, (data.length >> 7) & 127, data.length & 127]
        : [(data.length >>> 24) & 255, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255];
      body.push(...[...id].map((c) => c.charCodeAt(0)), ...size, 0, 0, ...data);
    }
    const n = body.length;
    return Uint8Array.from([
      0x49, 0x44, 0x33, version, 0, 0,
      (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127,
      ...body,
      0xff, 0xfb, // where the audio would start
    ]).buffer;
  }

  function textBytes(encoding: number, text: string): number[] {
    if (encoding === 1) {
      const out = [0xff, 0xfe]; // little-endian BOM
      for (const char of text) {
        const code = char.charCodeAt(0);
        out.push(code & 255, code >> 8);
      }
      return out;
    }
    return [...new TextEncoder().encode(text)];
  }

  test('reads the artist and the title of a v2.3 tag', () => {
    expect(readId3(tag(3, [['TPE1', 0, 'Kino'], ['TIT2', 0, 'Kukushka']]))).toEqual({
      artist: 'Kino',
      title: 'Kukushka',
    });
  });

  test('reads UTF-16 and UTF-8 frames of a v2.4 tag', () => {
    expect(readId3(tag(4, [['TPE1', 1, 'Кино'], ['TIT2', 3, 'Кукушка']]))).toEqual({
      artist: 'Кино',
      title: 'Кукушка',
    });
  });

  test('a file with no tag, or only some of it, gives empty strings', () => {
    expect(readId3(Uint8Array.from([0xff, 0xfb, 0, 0]).buffer)).toEqual({ artist: '', title: '' });
    expect(readId3(new ArrayBuffer(0))).toEqual({ artist: '', title: '' });
    expect(readId3(tag(4, [['TIT2', 3, 'Кукушка']]))).toEqual({ artist: '', title: 'Кукушка' });
  });

  test('a size that runs past the buffer does not read past it', () => {
    const bytes = new Uint8Array(tag(3, [['TIT2', 0, 'Kukushka']]));
    bytes[17] = 200; // the frame claims 200 bytes of text
    expect(readId3(bytes.buffer)).toEqual({ artist: '', title: '' });
  });
});

describe('tenth audit: trackCredits', () => {
  test('clips a tag longer than the server takes, so the publish keeps its sound', () => {
    // The API answers 400 to credits over 120 characters and the web shell
    // drops the track without a word; a long ID3 title did exactly that.
    const long = 'Очень'.repeat(40);
    const credits = trackCredits({ title: long, artist: long }, 'file', '');
    expect(credits.name.length).toBe(AUDIO_MAX_CREDIT);
    expect(credits.author.length).toBe(AUDIO_MAX_CREDIT);
    expect(AUDIO_MAX_CREDIT).toBe(120);
  });

  test('the file\'s own tags win over the file name', () => {
    expect(trackCredits({ title: 'Песня', artist: 'Кто-то' }, 'file', 'я')).toEqual({ name: 'Песня', author: 'Кто-то' });
  });

  test('an untagged file does not inherit the artist the last file\'s tags put there', () => {
    // «Заменить файл…» passed the field on as the fallback, so song B went
    // out credited to song A's artist.
    expect(trackCredits({ title: '', artist: '' }, 'b', 'Кто-то', 'Кто-то')).toEqual({ name: 'b', author: '' });
  });

  test('an author the person typed survives the replacement', () => {
    expect(trackCredits({ title: '', artist: '' }, 'b', 'Я сам', 'Кто-то')).toEqual({ name: 'b', author: 'Я сам' });
  });
});

// The API keeps a soundtrack only if its bytes open as mp3, ogg or wav and it
// weighs no more than 10 MB (`audio_type` / `MAX_AUDIO_BYTES` in
// services/api/src/publications/web.rs). Anything else goes out silent.
describe('publishProblem', () => {
  const head = (s: number[]) => Uint8Array.from([...s, ...new Array(12).fill(0)].slice(0, 12));
  test('an ID3 mp3 under the limit publishes', () => {
    expect(publishProblem(head([0x49, 0x44, 0x33]), 1024)).toBeNull();
  });
  test('a bare mp3 frame, ogg and wav publish', () => {
    expect(publishProblem(head([0xff, 0xfb]), 1024)).toBeNull();
    expect(publishProblem(head([0x4f, 0x67, 0x67, 0x53]), 1024)).toBeNull();
    const wav = new TextEncoder().encode('RIFF\0\0\0\0WAVE');
    expect(publishProblem(wav, 1024)).toBeNull();
  });
  test('a flac or m4a will not publish', () => {
    expect(publishProblem(new TextEncoder().encode('fLaC\0\0\0\0\0\0\0\0'), 1024)).toBe('format');
    expect(publishProblem(new TextEncoder().encode('\0\0\0\x20ftypM4A '), 1024)).toBe('format');
  });
  test('past the server cap it will not publish', () => {
    expect(publishProblem(head([0x49, 0x44, 0x33]), PUBLISH_AUDIO_MAX_BYTES)).toBeNull();
    expect(publishProblem(head([0x49, 0x44, 0x33]), PUBLISH_AUDIO_MAX_BYTES + 1)).toBe('size');
  });
});
