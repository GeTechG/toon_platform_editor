/**
 * The editor's one audio track: the file, its credits, the envelope drawn on
 * the timeline, and playback. Decoding happens once through an
 * `AudioContext`; the samples are thrown away and only the envelope kept.
 * Playback rides a plain `<audio>` element — it seeks, it keeps its own
 * clock, and it needs no graph.
 */

import {
  ENVELOPE_RATE,
  checkAudioFile,
  timeForFrame,
  trackEnvelope,
  waveformPeaks,
} from './track';

/** A track as it is stored and published: bytes plus the credits. */
export interface AudioTrackData {
  blob: Blob;
  name: string;
  author: string;
}

export class AudioTrackState {
  blob = $state<Blob | null>(null);
  name = $state('');
  author = $state('');
  /** Loudness at `ENVELOPE_RATE`; empty until a track is loaded. */
  envelope = $state<Float32Array>(new Float32Array(0));
  duration = $state(0);
  /** Why the last load was refused, shown next to the note button. */
  error = $state('');

  #element: HTMLAudioElement | null = null;
  #url = '';

  get hasTrack(): boolean {
    return this.blob !== null;
  }

  /** True while the track is actually sounding — then it, not rAF, is the clock. */
  get sounding(): boolean {
    return this.#element !== null && !this.#element.paused && !this.#element.ended;
  }

  /** Where the track is, in seconds. */
  get currentTime(): number {
    return this.#element?.currentTime ?? 0;
  }

  /** One bar per frame at `fps` — what the timeline draws under the strip. */
  peaks(fps: number): Float32Array {
    return waveformPeaks(this.envelope, ENVELOPE_RATE, fps);
  }

  /**
   * Accepts a picked file: checks it, decodes it for the envelope, keeps the
   * bytes. Returns false and fills `error` if the file is not usable.
   */
  async load(file: Blob & { type: string; size: number }, name: string, author = ''): Promise<boolean> {
    const complaint = checkAudioFile(file);
    if (complaint) {
      this.error = complaint;
      return false;
    }
    try {
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        this.envelope = trackEnvelope(decoded);
        this.duration = decoded.duration;
      } finally {
        void context.close();
      }
    } catch (err) {
      console.warn('audio decode failed:', err);
      this.error = 'Не получилось прочитать звук';
      return false;
    }
    this.#adopt(file, name, author);
    this.error = '';
    return true;
  }

  /** Restores a track that came back from a draft — already checked, already decoded once. */
  async restore(track: AudioTrackData): Promise<void> {
    await this.load(track.blob as Blob & { type: string; size: number }, track.name, track.author);
  }

  #adopt(blob: Blob, name: string, author: string): void {
    this.stop();
    this.#revoke();
    this.blob = blob;
    this.name = name;
    this.author = author;
    this.#url = URL.createObjectURL(blob);
    const element = new Audio(this.#url);
    // Fetch it now rather than on the first press: a preview started against
    // an element that has not loaded yet plays nothing and says nothing.
    element.preload = 'auto';
    // `decodeAudioData` and the media element are different decoders — a file
    // the envelope was built from can still be one this browser will not
    // play. Silence with no explanation is the worst outcome, so it is named.
    element.onerror = () => {
      this.error = 'Этот звук браузер не проигрывает — попробуй mp3';
    };
    element.load();
    this.#element = element;
  }

  /** Drops the track and everything it holds. */
  clear(): void {
    this.stop();
    this.#revoke();
    this.blob = null;
    this.name = '';
    this.author = '';
    this.envelope = new Float32Array(0);
    this.duration = 0;
    this.error = '';
  }

  #revoke(): void {
    this.#element = null;
    if (this.#url) {
      URL.revokeObjectURL(this.#url);
      this.#url = '';
    }
  }

  /**
   * Starts the sound where frame `frame` sits. Past the end of the track the
   * animation simply plays on in silence, as the reference does.
   */
  playFrom(frame: number, fps: number): void {
    if (!this.#element) {
      return;
    }
    const at = timeForFrame(frame, fps);
    // Past the end of the track the animation plays on in silence, as the
    // reference does. An unknown duration is not a reason to stay quiet.
    if (this.duration > 0 && at >= this.duration) {
      return;
    }
    this.#element.currentTime = at;
    void this.#element.play().catch((err) => {
      // A refused play is the one failure the person can act on — browsers
      // block sound until the page has been interacted with. Saying so beats
      // a console line nobody reads.
      console.warn('audio playback failed:', err);
      this.error = 'Браузер не дал включить звук — нажми «Проиграть» ещё раз';
    });
  }

  stop(): void {
    this.#element?.pause();
  }
}
