/**
 * Reactive editor state: Svelte 5 runes over the plain model.
 * Document mutations go through model operations only.
 */

import type { ToonDocument } from '../format/types';
import {
  DEFAULT_BRUSH_COLOR,
  DEFAULT_BRUSH_SIZE_LOGICAL,
  MAX_BRUSH_SIZE_LOGICAL,
  MAX_FRAMES,
  MIN_BRUSH_SIZE_LOGICAL,
} from '../format/constants';
import {
  addFrame,
  cloneFrame,
  createDocument,
  insertFrameBefore,
  removeFrame,
  removeLastStroke,
  replaceFrame,
  setFrameRate,
  type ResolvedFrame,
} from '../model/operations';
import { activeFrameAfterRemove, clampPlayerFps, onionSkinVisible } from './frame-selection';
import { nudgeBrushSize, resolveToolSelection, toolAfterColorChange, type UxProfile } from './ux-profile';
import {
  DEFAULT_PRESET,
  DEFAULT_DRAWING_UI_CONFIG,
  loadUiConfig,
  presetDrawingProfile,
  presetFeatures,
  presetUx,
  saveUiConfig,
  type DrawingProfileId,
  type FeatureKey,
  type Features,
} from './presets';

export type Tool = 'pencil' | 'eraser' | 'pipette';

export class EditorState {
  tool = $state<Tool>('pencil');
  doc = $state(createDocument());
  activeFrame = $state(0);
  playing = $state(false);
  /** Frame shown while playback is running. */
  playbackFrame = $state(0);
  drawingProfile = $state<DrawingProfileId>('multator');
  multatorBrushSizeLogical = $state(DEFAULT_BRUSH_SIZE_LOGICAL);
  tonioBrushSizeLogical = $state(DEFAULT_DRAWING_UI_CONFIG.tonio.width);
  tonioSmooth = $state(DEFAULT_DRAWING_UI_CONFIG.tonio.smooth);
  tonioMinDistance = $state(DEFAULT_DRAWING_UI_CONFIG.tonio.minDistance);
  brushColor = $state(DEFAULT_BRUSH_COLOR);
  /** Onion-skin toggle; ignored during playback. */
  onionSkin = $state(true);
  /** Clipboard for frame copy/paste (deep-copied on copy). */
  copiedFrame = $state<ResolvedFrame | null>(null);
  /**
   * Whether the full color picker is expanded (M hotkey). With a quick
   * palette (Multator) the collapsed state shows its two swatches; without
   * one, collapsed simply hides the picker.
   */
  paletteExpanded = $state(true);
  /** Bumped on frame copy/paste so the view can flash a confirmation. */
  flashTick = $state(0);
  /** Set once the user changes the document — gates autosave and draft restore. */
  touched = $state(false);

  /** Active UI preset id and the per-button visibility map (persisted). */
  preset = $state(DEFAULT_PRESET);
  features = $state<Features>(presetFeatures(DEFAULT_PRESET));

  constructor() {
    const saved = loadUiConfig();
    if (saved) {
      this.preset = saved.preset;
      this.features = saved.features;
      this.drawingProfile = saved.drawing.activeProfile;
      this.multatorBrushSizeLogical = saved.drawing.multatorWidth;
      this.tonioBrushSizeLogical = saved.drawing.tonio.width;
      this.tonioSmooth = saved.drawing.tonio.smooth;
      this.tonioMinDistance = saved.drawing.tonio.minDistance;
    }
    this.paletteExpanded = this.ux.quickPalette === null;
    this.doc = createDocument({ frameRate: this.ux.defaultFps });
  }

  /** Behavior profile of the active preset (palette, eraser rule, onion side, frames, playback). */
  get ux(): UxProfile {
    return presetUx(this.preset);
  }

  get brushSizeLogical(): number {
    return this.drawingProfile === 'toonio' ? this.tonioBrushSizeLogical : this.multatorBrushSizeLogical;
  }

  set brushSizeLogical(value: number) {
    if (this.drawingProfile === 'toonio') {
      this.tonioBrushSizeLogical = Math.min(500, Math.max(1, Math.round(value)));
    } else {
      this.multatorBrushSizeLogical = Math.min(MAX_BRUSH_SIZE_LOGICAL, Math.max(MIN_BRUSH_SIZE_LOGICAL, Math.round(value)));
    }
    this.persistUiConfig();
  }

  setTonioSmooth(value: number): void {
    this.tonioSmooth = Math.min(100, Math.max(1, Math.round(value)));
    this.persistUiConfig();
  }

  setTonioMinDistance(value: number): void {
    this.tonioMinDistance = Math.min(30, Math.max(0, Math.round(value)));
    this.persistUiConfig();
  }

  /**
   * Switch to a preset, resetting toolbar visibility, its drawing profile and
   * UX defaults. An untouched document also takes the preset's frame rate;
   * work in progress keeps its own tempo.
   */
  applyPreset(id: string): void {
    this.preset = id;
    this.features = presetFeatures(id);
    this.drawingProfile = presetDrawingProfile(id);
    this.paletteExpanded = this.ux.quickPalette === null;
    if (!this.touched) {
      setFrameRate(this.doc, this.ux.defaultFps);
    }
    this.persistUiConfig();
  }

  /**
   * Tool selection through the profile's rules: under Multator the pencil
   * with a white color is the eraser and the pipette needs the expanded
   * palette. Unavailable requests are ignored.
   */
  selectTool(tool: Tool): void {
    const resolved = resolveToolSelection(tool, this.brushColor, this.ux, this.paletteExpanded);
    if (resolved) {
      this.tool = resolved;
    }
  }

  /** Color choice from the palette/picker; under Multator white arms the eraser, anything else the pencil. */
  setBrushColor(color: string): void {
    this.brushColor = color.toLowerCase();
    const tool = toolAfterColorChange(this.brushColor, this.ux);
    if (tool) {
      this.tool = tool;
    }
  }

  /** Toggle one button's visibility, keeping the current preset id. */
  toggleFeature(key: FeatureKey): void {
    this.features = { ...this.features, [key]: !this.features[key] };
    this.persistUiConfig();
  }

  /** Reset toolbar visibility and drawing profile to the active preset defaults. */
  resetFeatures(): void {
    this.applyPreset(this.preset);
  }

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

  /** Ctrl+add in the reference: a new empty frame in front of the current one. */
  addFrameBeforeActive(): void {
    if (this.playing || this.doc.frames.length >= MAX_FRAMES) {
      return;
    }
    this.activeFrame = insertFrameBefore(this.doc, this.activeFrame);
    this.touched = true;
  }

  removeActiveFrame(): void {
    if (this.playing) {
      return;
    }
    removeFrame(this.doc, this.activeFrame);
    this.activeFrame = activeFrameAfterRemove(this.activeFrame, this.doc.frames.length, this.ux.afterRemove);
    this.touched = true;
  }

  setFps(value: number): void {
    setFrameRate(this.doc, clampPlayerFps(value));
    this.touched = true;
  }

  /** Copies the active frame's strokes to the clipboard (deep copy). */
  copyActiveFrame(): void {
    const frame = this.doc.frames[this.activeFrame];
    if (frame) {
      this.copiedFrame = cloneFrame(this.doc, frame);
      this.flashTick++;
    }
  }

  /** Pastes the clipboard strokes onto the active frame, replacing its contents. */
  pasteFrame(): void {
    if (this.playing || !this.copiedFrame) {
      return;
    }
    try {
      replaceFrame(this.doc, this.activeFrame, this.copiedFrame);
      this.touched = true;
      this.flashTick++;
    } catch (err) {
      // At the document point limit — drop the paste instead of throwing.
      console.warn('paste rejected:', err);
    }
  }

  /** Undo: drops the last stroke of the active frame (per-stroke, no redo). */
  undo(): void {
    if (this.playing) {
      return;
    }
    if (removeLastStroke(this.doc, this.activeFrame)) {
      this.touched = true;
    }
  }

  /** Grows the brush by the profile's step (+ hotkey), up to its maximum. */
  increaseBrushSize(): void {
    this.brushSizeLogical = nudgeBrushSize(this.brushSizeLogical, 1, this.ux);
  }

  /** Shrinks the brush by the profile's step (- hotkey), down to the minimum. */
  decreaseBrushSize(): void {
    this.brushSizeLogical = nudgeBrushSize(this.brushSizeLogical, -1, this.ux);
  }

  /** M hotkey / `enablePalette` in the reference: expand or collapse the full color picker. */
  togglePalette(): void {
    this.paletteExpanded = !this.paletteExpanded;
    // Collapsing the palette takes the pipette away with it (reference hides btnPicker).
    if (this.tool === 'pipette' && this.ux.pipetteNeedsPalette && !this.paletteExpanded) {
      this.tool = 'pencil';
    }
  }

  private persistUiConfig(): void {
    saveUiConfig({
      preset: this.preset,
      features: this.features,
      drawing: {
        activeProfile: this.drawingProfile,
        multatorWidth: this.multatorBrushSizeLogical,
        tonio: {
          width: this.tonioBrushSizeLogical,
          smooth: this.tonioSmooth,
          minDistance: this.tonioMinDistance,
        },
      },
    });
  }
}
