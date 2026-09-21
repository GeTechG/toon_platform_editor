/**
 * Video export. Where the browser has WebCodecs, frames go straight to a
 * `VideoEncoder` through mediabunny, which muxes mp4 or WebM — the export then
 * runs as fast as the machine encodes instead of in real time, and the
 * bitrate is ours to set. Where it does not, the old `MediaRecorder` over
 * `canvas.captureStream()` stays as the fallback, and the sheet says the
 * recording will take as long as the animation lasts.
 *
 * Frames come from the shared rasterizer, so resolution and watermark are
 * the same here as in GIF and PNG.
 */

import type { ToonDocument } from '../format/types';
import { frameCount } from '../model/operations';
import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
import {
  FrameRasterizer,
  exportSize,
  logicalSize,
  rasterViewport,
  stampWatermark,
  throwIfAborted,
  type ExportStage,
  type RasterizeOptions,
} from './rasterize';
import {
  AUDIO_BITRATE,
  VIDEO_BITRATE,
  selectVideoTarget,
  type VideoTarget,
} from './video-codecs';
import { t } from '../i18n';

export interface VideoFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
  /** What the export sheet calls it. */
  label: string;
}

export interface VideoContainer {
  extension: 'mp4' | 'webm';
  label: string;
  /** Codec strings to try, best first, when the export carries sound. */
  withSound: readonly string[];
  /**
   * The same for a silent export, where no audio codec is named: Firefox hangs
   * on a recorder promised Opus by a stream that has no audio track.
   */
  silent?: readonly string[];
}

/**
 * Best container first: mp4 plays everywhere a phone does. Each one lists the
 * codecs to ask for, because no two browsers record the same set — Chrome
 * writes H.264 into mp4 and VP9 into WebM, Firefox records WebM and only VP8.
 */
export const VIDEO_CONTAINERS: readonly VideoContainer[] = [
  {
    extension: 'mp4',
    label: 'MP4 (H.264)',
    withSound: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2'],
    silent: ['video/mp4;codecs=avc1.42E01E'],
  },
  {
    extension: 'webm',
    label: 'WebM',
    withSound: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'],
    silent: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'],
  },
];

/**
 * The formats `MediaRecorder` can record, best first — one entry per
 * container, carrying the first codec string it accepts. Only the fallback
 * path asks; the WebCodecs path asks the encoders themselves
 * (`./video-codecs`).
 */
export function supportedVideoFormats(
  hasAudio = true,
  isSupported: (mimeType: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): VideoFormat[] {
  const formats: VideoFormat[] = [];
  for (const container of VIDEO_CONTAINERS) {
    const candidates = hasAudio ? container.withSound : container.silent ?? container.withSound;
    const mimeType = candidates.find(isSupported);
    if (mimeType) {
      formats.push({ mimeType, extension: container.extension, label: container.label });
    }
  }
  return formats;
}

/**
 * How many frames the recording runs for. Without a tied track that is the
 * animation, once. With one, the track sets the length of the work and the
 * animation loops to fill it — a five-frame loop under a three-minute song is
 * a three-minute video, not half a second of it. A track shorter than the
 * animation never cuts the animation short.
 */
export function exportFrameCount(frames: number, fps: number, trackSeconds: number | undefined): number {
  if (trackSeconds === undefined) {
    return frames;
  }
  return Math.max(frames, Math.round(trackSeconds * fps));
}

/** When each frame is due, in ms from the start — the document's own tempo. */
export function frameDeadlines(count: number, fps: number): Float64Array {
  return Float64Array.from({ length: count }, (_, i) => (i * 1000) / fps);
}

/**
 * Copies the track into the video's own length: a short track repeats until
 * the video ends, a long one is cut where the video does.
 */
export function fillLooped(source: Float32Array, out: Float32Array): void {
  if (source.length === 0) {
    return;
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = source[i % source.length];
  }
}

/** What this browser will write, and by which of the two paths. */
export interface VideoPlan {
  extension: 'mp4' | 'webm';
  label: string;
  /** True when only `MediaRecorder` is left: the export takes the animation's own length. */
  realtime: boolean;
  target?: VideoTarget;
  format?: VideoFormat;
}

/** Picks the export path: WebCodecs first, `MediaRecorder` if it cannot. */
export async function planVideo(doc: ToonDocument, hasAudio: boolean, width?: number): Promise<VideoPlan | null> {
  const size = exportSize(doc, width ?? logicalSize(doc).width);
  const target = await selectVideoTarget({ hasAudio, ...size });
  if (target) {
    return { extension: target.extension, label: target.label, realtime: false, target };
  }
  const format = supportedVideoFormats(hasAudio)[0];
  return format
    ? { extension: format.extension, label: format.label, realtime: true, format }
    : null;
}

export interface VideoExportOptions extends RasterizeOptions {
  plan: VideoPlan;
  /** The soundtrack, muxed into the video; omitted for a silent export. */
  audio?: Blob | null;
  onProgress?: (done: number, total: number, stage: ExportStage) => void;
  /** Aborting drops the export; nothing is returned and nothing is saved. */
  signal?: AbortSignal;
  /**
   * Length of the track when it is not tied to the frames, in seconds. The
   * animation then loops for that long instead of playing once.
   */
  trackSeconds?: number;
}

/**
 * Renders the document through the same `Canvas2DFrameRenderer` the canvas,
 * the GIF and the player use, and encodes it. Resolves with the finished
 * file; rejects with an `AbortError` if cancelled.
 */
export function exportVideo(doc: ToonDocument, options: VideoExportOptions): Promise<Blob> {
  return options.plan.realtime ? recordVideo(doc, options) : encodeVideo(doc, options);
}

/** WebCodecs: frames are encoded as fast as the machine manages. */
async function encodeVideo(doc: ToonDocument, options: VideoExportOptions): Promise<Blob> {
  const { plan, audio, onProgress, signal, trackSeconds, ...raster } = options;
  const target = plan.target;
  if (!target) {
    throw new Error(t('export.no_codec'));
  }
  const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, WebMOutputFormat } =
    await import('mediabunny');

  const fps = doc.frame_rate;
  const frames = frameCount(doc);
  const total = exportFrameCount(frames, fps, trackSeconds);
  const rasterizer = new FrameRasterizer(doc, raster);
  const buffer = new BufferTarget();
  const output = new Output({
    format: target.extension === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: buffer,
  });
  const video = new CanvasSource(rasterizer.canvas, {
    codec: target.videoCodec,
    quality: new Quality({ bitrate: VIDEO_BITRATE }),
  });
  output.addVideoTrack(video, { frameRate: fps });
  const sound =
    target.audioCodec && audio
      ? new AudioBufferSource({
          codec: target.audioCodec,
          quality: new Quality({ bitrate: AUDIO_BITRATE }),
        })
      : null;
  if (sound) {
    output.addAudioTrack(sound);
  }

  try {
    await output.start();
    if (sound && audio) {
      await sound.add(await buildSoundtrack(audio, total / fps));
      sound.close();
    }
    for (let index = 0; index < total; index++) {
      throwIfAborted(signal);
      rasterizer.draw(index % frames);
      await video.add(index / fps, 1 / fps);
      onProgress?.(index + 1, total, 'encode');
    }
    video.close();
    await output.finalize();
    return new Blob([buffer.buffer as ArrayBuffer], { type: output.format.mimeType });
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  }
}

/**
 * The track, decoded and laid out over the whole video: looped where it is
 * shorter, cut where it is longer.
 */
async function buildSoundtrack(audio: Blob, seconds: number): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await audio.arrayBuffer());
    const out = ctx.createBuffer(
      decoded.numberOfChannels,
      Math.max(1, Math.round(seconds * decoded.sampleRate)),
      decoded.sampleRate,
    );
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      fillLooped(decoded.getChannelData(channel), out.getChannelData(channel));
    }
    return out;
  } finally {
    void ctx.close();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Fallback for browsers without WebCodecs: `MediaRecorder` stamps frames by
 * the wall clock, so this runs in real time — a 120-frame animation at 12 fps
 * takes ten seconds.
 */
async function recordVideo(doc: ToonDocument, options: VideoExportOptions): Promise<Blob> {
  const { plan, audio, onProgress, signal, trackSeconds, width, watermark } = options;
  const format = plan.format;
  if (!format) {
    throw new Error(t('export.no_video'));
  }
  const { width: targetWidth, height } = exportSize(doc, width ?? logicalSize(doc).width);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas 2d context unavailable');
  }

  const fps = doc.frame_rate;
  // A stream we clock ourselves keeps every frame exact. Where `requestFrame`
  // is missing the browser samples the canvas at the document rate instead —
  // the paint loop runs in real time either way.
  const manual = canvas.captureStream(0);
  const videoTrack = manual.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const manualFrames = typeof videoTrack?.requestFrame === 'function';
  let stream = manual;
  if (!manualFrames) {
    manual.getTracks().forEach((track) => track.stop());
    stream = canvas.captureStream(fps);
  }

  let audioElement: HTMLAudioElement | null = null;
  let audioContext: AudioContext | null = null;
  let audioUrl = '';
  if (audio) {
    audioUrl = URL.createObjectURL(audio);
    audioElement = new Audio(audioUrl);
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    audioContext.createMediaElementSource(audioElement).connect(destination);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  }

  const recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };
  const recorded = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: format.mimeType }));
    recorder.onerror = () => reject(new Error(t('export.recording_failed')));
  });

  const frames = frameCount(doc);
  const total = exportFrameCount(frames, fps, trackSeconds);
  const deadlines = frameDeadlines(total, fps);
  const viewport = rasterViewport(doc, targetWidth);
  const scale = targetWidth / logicalSize(doc).width;
  const renderer = new Canvas2DFrameRenderer();
  try {
    recorder.start();
    await audioElement?.play().catch((err) => console.warn('audio playback failed:', err));
    const started = performance.now();
    for (let index = 0; index < total; index++) {
      throwIfAborted(signal);
      await sleep(started + deadlines[index] - performance.now());
      renderer.render(doc, index % frames, ctx as unknown as Canvas2DLike, viewport);
      if (watermark) {
        stampWatermark(ctx, targetWidth, height, scale);
      }
      if (manualFrames) {
        videoTrack.requestFrame();
      }
      onProgress?.(index + 1, total, 'encode');
    }
    // Hold the last frame for its own duration, or it flashes past.
    await sleep(started + (total * 1000) / fps - performance.now());
    recorder.stop();
    return await recorded;
  } finally {
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    stream.getTracks().forEach((track) => track.stop());
    audioElement?.pause();
    void audioContext?.close();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
  }
}
