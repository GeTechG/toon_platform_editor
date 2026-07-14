/**
 * Reactive editor state: Svelte 5 runes over the plain model.
 * Document mutations go through model operations only.
 */

import { DEFAULT_BRUSH_COLOR, DEFAULT_BRUSH_SIZE_LOGICAL } from '../format/constants';
import { addFrame, createDocument, removeFrame, setFrameRate } from '../model/operations';
import { activeFrameAfterRemove, clampPlayerFps } from './frame-selection';

export class EditorState {
  doc = $state(createDocument());
  activeFrame = $state(0);
  playing = $state(false);
  /** Frame shown while playback is running. */
  playbackFrame = $state(0);
  brushSizeLogical = $state(DEFAULT_BRUSH_SIZE_LOGICAL);
  brushColor = $state(DEFAULT_BRUSH_COLOR);

  /** The frame that should currently be on the canvas. */
  get displayedFrame(): number {
    return this.playing ? this.playbackFrame : this.activeFrame;
  }

  selectFrame(index: number): void {
    if (this.playing || index < 0 || index >= this.doc.frames.length) {
      return;
    }
    this.activeFrame = index;
  }

  addFrameAfterActive(): void {
    if (this.playing) {
      return;
    }
    this.activeFrame = addFrame(this.doc, this.activeFrame);
  }

  removeActiveFrame(): void {
    if (this.playing) {
      return;
    }
    removeFrame(this.doc, this.activeFrame);
    this.activeFrame = activeFrameAfterRemove(this.activeFrame, this.doc.frames.length);
  }

  setFps(value: number): void {
    setFrameRate(this.doc, clampPlayerFps(value));
  }
}
