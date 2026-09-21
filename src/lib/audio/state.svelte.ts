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
  readId3,
  trackEnvelope,
  trackTimeFor,
  waveformBars,
} from './track';
import { t } from '../i18n';

/** A track as it is stored and published: bytes plus the credits. */
export interface AudioTrackData {
  blob: Blob;
  name: string;
  author: string;
  /** Whether the frames are tied to the track; see `AudioTrackState.sync`. */
  sync?: boolean;
}

export class AudioTrackState {
  blob = $state<Blob | null>(null);
  name = $state('');
  author = $state('');
  /** Loudness at `ENVELOPE_RATE`; empty until a track is loaded. */
  envelope = $state<Float32Array>(new Float32Array(0));
  duration = $state(0);
  /**
   * The reference's synchronisation flag. Tied, the track is the clock: frame
   * N always falls on second N/fps of it, and when the animation comes round
   * again the track starts again with it — exact, at the cost of a jump
   * whenever the two lengths do not divide. Untied (the default), the frames
   * keep their own clock and the track just plays underneath, which is what
   * background music wants.
   *
   * Untied is the default because the animation loop is frames/fps long: on a
   * one-frame document a tied track is rewound twelve times a second, and the
   * preview looks right while sounding like nothing at all. A track stored
   * without the flag still reads as tied — that was its behaviour.
   */
  sync = $state(false);
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

  /**
   * `barsPerFrame` bars per frame at `fps` — what the timeline draws under
   * the strip, the reference's half-a-bar-per-pixel wave.
   */
  bars(fps: number, barsPerFrame: number): Float32Array {
    return waveformBars(this.envelope, ENVELOPE_RATE, fps, barsPerFrame);
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
    let tags = { artist: '', title: '' };
    try {
      const bytes = await file.arrayBuffer();
      tags = readId3(bytes);
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(bytes);
        this.envelope = trackEnvelope(decoded);
        this.duration = decoded.duration;
      } finally {
        void context.close();
      }
    } catch (err) {
      console.warn('audio decode failed:', err);
      this.error = t('audio.undecodable');
      return false;
    }
    // What the file says about itself wins over the file name, which is what
    // the caller passes when it knows nothing better.
    this.#adopt(file, tags.title || name, tags.artist || author);
    this.error = '';
    return true;
  }

  /**
   * Restores a track that came back from a draft. The size it was stored at
   * is checked first: storage that hands back a short file would otherwise
   * turn a three-minute song into a few silent seconds with nothing said.
   */
  async restore(track: AudioTrackData & { bytes?: number }): Promise<void> {
    if (typeof track.bytes === 'number' && track.bytes !== track.blob.size) {
      this.error = t('audio.draft_broken');
      console.warn(`draft track is ${track.blob.size} bytes, was stored at ${track.bytes}`);
      return;
    }
    // A track stored before the flag existed was tied — that was its behaviour.
    this.sync = track.sync ?? true;
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
    // The frames loop, so the sound does too — a track shorter than the
    // animation would otherwise run out part-way through the preview and
    // leave the rest of it silent. Same rule as the share player.
    element.loop = true;
    // Fetch it now rather than on the first press: a preview started against
    // an element that has not loaded yet plays nothing and says nothing.
    element.preload = 'auto';
    // `decodeAudioData` and the media element are different decoders — a file
    // the envelope was built from can still be one this browser will not
    // play. Silence with no explanation is the worst outcome, so it is named.
    element.onerror = () => {
      this.error = t('audio.unplayable');
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
    this.sync = false;
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
   * Starts the sound. Tied to the frames it begins where frame `frame` sits
   * inside the track — and stays silent past the track's end, since no frame
   * out there has any sound of its own. Untied it begins at the top of the
   * track, which is what "just play this underneath" means.
   */
  playFrom(frame: number, fps: number): void {
    if (!this.#element) {
      return;
    }
    const at = this.sync ? trackTimeFor(frame, fps, this.duration) : 0;
    if (at === null) {
      // Past the end of a tied track: quiet until the animation comes round.
      this.stop();
      return;
    }
    // Tied, the loop belongs to the animation, not to the track: the element
    // must not wrap on its own, or the tail of a long pass would hear the
    // beginning of the track again. Untied, looping under the frames is the
    // whole point.
    this.#element.loop = !this.sync;
    this.#element.currentTime = at;
    void this.#element.play().catch((err) => {
      // A refused play is the one failure the person can act on — browsers
      // block sound until the page has been interacted with. Saying so beats
      // a console line nobody reads.
      console.warn('audio playback failed:', err);
      this.error = t('audio.blocked');
    });
  }

  /**
   * Tied, the animation is the timeline: every time the preview comes back
   * round to the frame it started on, the track is pulled to where that frame
   * sits in it and played from there — which is also how a track that ran out
   * during the pass starts again. Same rule as `playFrom`, so there is one
   * place that decides where a tied track stands.
   *
   * ponytail: realigned once per pass, so a long pass can drift by whatever
   * the element's clock drifts — inaudible at these lengths. Reseek per frame
   * if it ever is not.
   */
  reseekAtLoop(frame: number, fps: number): boolean {
    if (!this.sync || !this.#element) {
      return false;
    }
    this.playFrom(frame, fps);
    return true;
  }

  stop(): void {
    this.#element?.pause();
  }
}
