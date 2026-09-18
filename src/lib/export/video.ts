/**
 * Video export: the animation, its soundtrack and an optional watermark, in
 * mp4 where the browser can record it and WebM everywhere else.
 *
 * There is no muxer library here and no ffmpeg.wasm. `MediaRecorder` over
 * `canvas.captureStream()` is a browser feature that already encodes off the
 * main thread, already accepts an audio track, and already writes both
 * containers — Chromium and Safari record `video/mp4` with H.264 + AAC,
 * Firefox records WebM with VP9 + Opus. PRODUCT.md's device floor rules out
 * the 26 MB fallback the reference ships.
 *
 * ponytail: `MediaRecorder` stamps frames by the wall clock, so the export
 * runs in real time — a 120-frame animation at 12 fps takes ten seconds.
 * Upgrade path if that ever grates: `VideoEncoder` (WebCodecs) plus a muxer,
 * which encodes as fast as the CPU allows.
 */

import { BACKGROUND_COLOR, FIXED_POINT_SCALE } from '../format/constants';
import type { ToonDocument } from '../format/types';
import { frameCount } from '../model/operations';
import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';

export interface VideoFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
  /** What the export sheet calls it. */
  label: string;
}

/** Best container first: mp4 plays everywhere a phone does. */
export const VIDEO_FORMATS: readonly VideoFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4', label: 'MP4 (H.264)' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm', label: 'WebM (VP9)' },
];

/** The formats this browser can actually record, best first. */
export function supportedVideoFormats(
  isSupported: (mimeType: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): VideoFormat[] {
  return VIDEO_FORMATS.filter((format) => isSupported(format.mimeType));
}

/** When each frame is due, in ms from the start — the document's own tempo. */
export function frameDeadlines(count: number, fps: number): Float64Array {
  return Float64Array.from({ length: count }, (_, i) => (i * 1000) / fps);
}

export interface VideoExportOptions {
  format: VideoFormat;
  /** The soundtrack, muxed into the recording; omitted for a silent export. */
  audio?: Blob | null;
  /** Stamped into the corner of every frame when set. */
  watermark?: string;
  onProgress?: (done: number, total: number) => void;
  /** Aborting drops the recording; nothing is returned and nothing is saved. */
  signal?: AbortSignal;
}

export const WATERMARK_TEXT = 'toonop';

/** Corner stamp, sized to the canvas so it reads the same at any document size. */
function stampWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, text: string): void {
  const size = Math.max(10, Math.round(height / 18));
  ctx.save();
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  // Ink on a light halo: legible over a dark drawing and over an empty canvas.
  ctx.lineWidth = Math.max(2, size / 6);
  ctx.strokeStyle = BACKGROUND_COLOR;
  ctx.globalAlpha = 0.55;
  ctx.strokeText(text, width - size / 2, height - size / 2);
  ctx.fillStyle = '#000000';
  ctx.globalAlpha = 0.45;
  ctx.fillText(text, width - size / 2, height - size / 2);
  ctx.restore();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Records the document, in playback order at its own frame rate, through the
 * same `Canvas2DFrameRenderer` the canvas, the GIF and the player use.
 * Resolves with the finished file; rejects with an `AbortError` if cancelled.
 */
export async function exportVideo(doc: ToonDocument, options: VideoExportOptions): Promise<Blob> {
  const { format, audio, watermark, onProgress, signal } = options;
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('этот браузер не умеет записывать видео');
  }
  const width = Math.max(1, Math.round(doc.width / FIXED_POINT_SCALE));
  const height = Math.max(1, Math.round(doc.height / FIXED_POINT_SCALE));
  const canvas = document.createElement('canvas');
  canvas.width = width;
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
    recorder.onerror = () => reject(new Error('запись видео сорвалась'));
  });

  const total = frameCount(doc);
  const deadlines = frameDeadlines(total, fps);
  const viewport = { scale: 1 / FIXED_POINT_SCALE, dpr: 1 };
  const renderer = new Canvas2DFrameRenderer();
  try {
    recorder.start();
    await audioElement?.play().catch((err) => console.warn('audio playback failed:', err));
    const started = performance.now();
    for (let index = 0; index < total; index++) {
      if (signal?.aborted) {
        throw new DOMException('экспорт отменён', 'AbortError');
      }
      await sleep(started + deadlines[index] - performance.now());
      renderer.render(doc, index, ctx as unknown as Canvas2DLike, viewport);
      if (watermark) {
        stampWatermark(ctx, width, height, watermark);
      }
      if (manualFrames) {
        videoTrack.requestFrame();
      }
      onProgress?.(index + 1, total);
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

