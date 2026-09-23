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

/**
 * Rate the file is decoded at for its envelope. `decodeAudioData` resamples to
 * its context's rate, and the envelope keeps only `ENVELOPE_RATE` levels a
 * second: at the device's 48 kHz a five-minute song is ~115 MB of floats, at
 * this a sixth of it — the difference on a 2 GB phone. An offline context
 * also never wakes the audio output just to read a file.
 */
const DECODE_RATE = 8000;

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
  /** A picked file is being read; a long one takes seconds on a cheap phone. */
  loading = $state(false);

  #element: HTMLAudioElement | null = null;
  #url = '';
  /** Which pick is the latest: a slow decode must not land over a quicker, later one. */
  #ticket = 0;

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
   * bytes. Returns false and fills `error` if the file is not usable — and,
   * with `keep`, holds on to it anyway: a draft's own track that will not
   * decode here is still that draft's, and dropping it would leave the last
   * draft's track playing under this one.
   */
  async load(
    file: Blob & { type: string; size: number },
    name: string,
    author = '',
    keep = false,
  ): Promise<boolean> {
    const ticket = ++this.#ticket;
    const complaint = checkAudioFile(file);
    if (complaint) {
      this.loading = false;
      this.error = complaint;
      if (keep) this.#adoptUnread(file, name, author);
      return false;
    }
    this.loading = true;
    let tags = { artist: '', title: '' };
    let envelope: Float32Array;
    let duration: number;
    try {
      const bytes = await file.arrayBuffer();
      tags = readId3(bytes);
      const decoded = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(bytes);
      envelope = trackEnvelope(decoded);
      duration = decoded.duration;
    } catch (err) {
      console.warn('audio decode failed:', err);
      if (ticket === this.#ticket) {
        this.loading = false;
        this.error = t('audio.undecodable');
        if (keep) this.#adoptUnread(file, name, author);
      }
      return false;
    }
    if (ticket !== this.#ticket) {
      return false; // a later pick, or the bin, came first
    }
    this.loading = false;
    this.envelope = envelope;
    this.duration = duration;
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
    // A track stored before the flag existed was tied — that was its behaviour.
    this.sync = track.sync ?? true;
    if (typeof track.bytes === 'number' && track.bytes !== track.blob.size) {
      console.warn(`draft track is ${track.blob.size} bytes, was stored at ${track.bytes}`);
      this.#ticket++;
      this.loading = false;
      this.#adoptUnread(track.blob, track.name, track.author);
      this.error = t('audio.draft_broken');
      return;
    }
    await this.load(track.blob as Blob & { type: string; size: number }, track.name, track.author, true);
  }

  /** A draft's own file that cannot be read here: kept and named, with no wave. */
  #adoptUnread(blob: Blob, name: string, author: string): void {
    this.envelope = new Float32Array(0);
    this.duration = 0;
    this.#adopt(blob, name, author);
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
    this.#ticket++; // a decode still running must not bring the track back
    this.loading = false;
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
    const element = this.#element;
    if (element) {
      // Revoking the URL under an element still fetching it fires its
      // onerror, and the message landed on the track that replaced it.
      element.onerror = null;
      element.removeAttribute('src');
      element.load();
    }
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
    void this.#element.play().then(
      () => {
        // The press that got through answers the complaint about the one that did not.
        if (this.error === t('audio.blocked')) this.error = '';
      },
      (err) => {
        // A refused play is the one failure the person can act on — browsers
        // block sound until the page has been interacted with. Saying so beats
        // a console line nobody reads.
        console.warn('audio playback failed:', err);
        this.error = t('audio.blocked');
      },
    );
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
