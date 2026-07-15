/**
 * Reactive editor state: Svelte 5 runes over the plain model.
 * Document mutations go through model operations only.
 */

import type { ToonDocument } from '../format/types';
import { DEFAULT_BRUSH_COLOR, DEFAULT_BRUSH_SIZE_LOGICAL, MAX_FRAMES } from '../format/constants';
import { addFrame, createDocument, removeFrame, setFrameRate } from '../model/operations';
import { activeFrameAfterRemove, clampPlayerFps, onionSkinVisible } from './frame-selection';

export class EditorState {
  doc = $state(createDocument());
  activeFrame = $state(0);
  playing = $state(false);
  /** Frame shown while playback is running. */
  playbackFrame = $state(0);
  brushSizeLogical = $state(DEFAULT_BRUSH_SIZE_LOGICAL);
  brushColor = $state(DEFAULT_BRUSH_COLOR);
  /** Onion-skin toggle; ignored during playback. */
  onionSkin = $state(true);
  /** Set once the user changes the document — gates autosave and draft restore. */
  touched = $state(false);

  /** The frame that should currently be on the canvas. */
  get displayedFrame(): number {
    return this.playing ? this.playbackFrame : this.activeFrame;
  }

  /** Whether onion-skin layers should currently render. */
  get showOnionSkin(): boolean {
    return onionSkinVisible(this.onionSkin, this.playing);
  }

  toggleOnionSkin(): void {
    this.onionSkin = !this.onionSkin;
  }

  /** Replaces the document (restored draft); not a user edit, so `touched` stays as is. */
  replaceDoc(doc: ToonDocument): void {
    this.doc = doc;
    this.activeFrame = 0;
    this.playing = false;
    this.playbackFrame = 0;
  }

  selectFrame(index: number): void {
    if (this.playing || index < 0 || index >= this.doc.frames.length) {
      return;
    }
    this.activeFrame = index;
  }

  addFrameAfterActive(): void {
    if (this.playing || this.doc.frames.length >= MAX_FRAMES) {
      return;
    }
    this.activeFrame = addFrame(this.doc, this.activeFrame);
    this.touched = true;
  }

  removeActiveFrame(): void {
    if (this.playing) {
      return;
    }
    removeFrame(this.doc, this.activeFrame);
    this.activeFrame = activeFrameAfterRemove(this.activeFrame, this.doc.frames.length);
    this.touched = true;
  }

  setFps(value: number): void {
    setFrameRate(this.doc, clampPlayerFps(value));
    this.touched = true;
  }
}
