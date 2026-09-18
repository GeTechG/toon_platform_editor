/**
 * Reactive editor state: Svelte 5 runes over the plain model.
 * Document mutations go through model operations only.
 */

import type { Frame, Stroke, ToonDocument } from '../format/types';
import {
  DEFAULT_BRUSH_COLOR,
  DEFAULT_FILL_COLOR,
  DEFAULT_BRUSH_SIZE_LOGICAL,
  MAX_BRUSH_SIZE_LOGICAL,
  MAX_FRAMES,
  MAX_LAYERS,
  CANVAS_LOGICAL_HEIGHT,
  CANVAS_LOGICAL_WIDTH,
  MIN_BRUSH_SIZE_LOGICAL,
  ONION_HISTORY_LENGTH,
  ONION_SKIN_ALPHAS,
} from '../format/constants';
import {
  addFrame,
  addLayer,
  addStroke,
  cloneColumn,
  createDocument,
  frameCount,
  insertFrameBefore,
  moveLayer,
  removeFrame,
  removeLastStroke,
  removeLayer,
  replaceColumn,
  replaceStrokes,
  setFrameRate,
  setLayerHidden,
  type ResolvedColumn,
  type ResolvedStroke,
} from '../model/operations';
import {
  activeFrameAfterRemove,
  activeLayerAfterMove,
  activeLayerAfterRemove,
  clampPlayerFps,
  onionHistoryLayers,
  onionLayers,
  onionSkinVisible,
  type OnionLayer,
  type PickSource,
} from './frame-selection';
import { addPaletteColor, loadPalette, savePalette } from './color-palette';
import { IDENTITY_VIEW, zoomAt, type Viewport2D } from './viewport';
import { eraseStrokes } from '../tools/mega-eraser';
import {
  nudgeBrushSize,
  resolveToolSelection,
  toolAfterColorChange,
  type SelectableTool,
  type UxProfile,
} from './ux-profile';
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

export type Tool = SelectableTool;

/**
 * How many undone strokes are kept for redo. Each entry holds a stroke that
 * is no longer in the document, so the stack is bounded — the design floor is
 * a 2 GB phone, not a workstation.
 */
export const UNDO_HISTORY_LIMIT = 50;

export class EditorState {
  tool = $state<Tool>('pencil');
  doc = $state(createDocument());
  activeFrame = $state(0);
  /** Layer the next stroke goes into; UI state, not part of the document. */
  activeLayer = $state(0);
  playing = $state(false);
  /** Frame shown while playback is running. */
  playbackFrame = $state(0);
  drawingProfile = $state<DrawingProfileId>('multator');
  multatorBrushSizeLogical = $state(DEFAULT_BRUSH_SIZE_LOGICAL);
  tonioBrushSizeLogical = $state(DEFAULT_DRAWING_UI_CONFIG.tonio.width);
  tonioSmooth = $state(DEFAULT_DRAWING_UI_CONFIG.tonio.smooth);
  tonioMinDistance = $state(DEFAULT_DRAWING_UI_CONFIG.tonio.minDistance);
  brushColor = $state(DEFAULT_BRUSH_COLOR);
  /** Second color: the feather fills with it, the pipette takes it on right-click. */
  fillColor = $state(DEFAULT_FILL_COLOR);
  /** Onion-skin toggle; ignored during playback. */
  onionSkin = $state(true);
  /** Last frames the user has been on — Tonio's onion is built from these. */
  visitedFrames = $state<number[]>([0]);
  /** Saved color grid (Tonio preset); persisted separately from the UI config. */
  palette = $state<string[]>(loadPalette());
  /** Canvas zoom and pan; view state only, never part of the document. */
  view = $state<Viewport2D>({ ...IDENTITY_VIEW });
  /** Canvas size in CSS px, kept current by CanvasView — zoom clamps against it. */
  viewSize = $state({ width: CANVAS_LOGICAL_WIDTH, height: CANVAS_LOGICAL_HEIGHT });
  /**
   * Cell contents captured before a mega-eraser cut, newest last. `after` is
   * the stroke count the cut left behind, so a stroke drawn on top of the cut
   * is undone first and the snapshot only comes back when the cell is in the
   * state the cut produced.
   */
  erases = $state<{ cell: Frame; strokes: Stroke[]; after: number }[]>([]);
  /** Strokes taken off by undo, newest last — what redo puts back. */
  undone = $state<{ cell: Frame; stroke: Stroke }[]>([]);
  /** Clipboard for frame copy/paste: every layer's cell, deep-copied on copy. */
  copiedColumn = $state<ResolvedColumn | null>(null);
  /** Where the pipette reads from; Alt overrides it for one click. */
  pickSource = $state<PickSource>(DEFAULT_DRAWING_UI_CONFIG.pickSource);
  /**
   * Whether the full color picker is expanded (M hotkey). With a quick
   * palette (Multator) the collapsed state shows its two swatches; without
   * one, collapsed simply hides the picker.
   */
  paletteExpanded = $state(true);
  /** Bumped on frame copy/paste so the view can flash a confirmation. */
  flashTick = $state(0);
  /**
   * The reference "old" easter egg: typing o, l, d toggles the oldschool pen
   * (a filled contour of variable width instead of a line). Multator line
   * profile only; Tonio strokes ignore it.
   */
  oldschool = $state(false);
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
      this.pickSource = saved.drawing.pickSource;
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
    this.ensureActiveLayerVisible();
    this.drawingProfile = presetDrawingProfile(id);
    this.paletteExpanded = this.ux.quickPalette === null;
    if (this.touched) {
      // A narrower profile range must not leave the document out of bounds.
      setFrameRate(this.doc, clampPlayerFps(this.doc.frame_rate, this.ux.fpsRange));
    } else {
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

  /** Swaps outline and fill (reference: the `X` button between the two swatches). */
  swapColors(): void {
    const outline = this.brushColor;
    this.brushColor = this.fillColor;
    this.fillColor = outline;
  }

  /** Keeps the current brush color in the saved grid (reference: «добавить в палитру»). */
  addCurrentColorToPalette(): void {
    this.palette = addPaletteColor(this.palette, this.brushColor);
    savePalette(this.palette);
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
    this.ensureActiveLayerVisible();
    this.persistUiConfig();
  }

  /**
   * With the layers panel gone the user has no way to unhide a layer, so a
   * hidden active layer would be a dead canvas — make it visible again. The
   * other hidden layers stay hidden; this is a document change.
   */
  ensureActiveLayerVisible(): void {
    if (this.features.layers) {
      return;
    }
    const layer = this.doc.layers[this.activeLayer];
    if (layer?.hidden) {
      setLayerHidden(this.doc, this.activeLayer, false);
      this.touched = true;
    }
  }

  /** The layer the next stroke goes into, or undefined while the document is swapped. */
  get activeLayerHidden(): boolean {
    return this.doc.layers[this.activeLayer]?.hidden ?? false;
  }

  selectLayer(index: number): void {
    if (index >= 0 && index < this.doc.layers.length) {
      this.activeLayer = index;
    }
  }

  /** Adds an empty layer above the active one; it becomes active. */
  addLayerAboveActive(): void {
    if (this.playing || this.doc.layers.length >= MAX_LAYERS) {
      return;
    }
    this.activeLayer = addLayer(this.doc, this.activeLayer);
    this.touched = true;
  }

  /** Whether a layer holds any stroke — the panel asks before deleting one that does. */
  layerHasStrokes(index: number): boolean {
    return this.doc.layers[index]?.frames.some((cell) => cell.strokes.length > 0) ?? false;
  }

  removeActiveLayer(): void {
    if (this.playing || this.doc.layers.length <= 1) {
      return;
    }
    const removed = this.activeLayer;
    removeLayer(this.doc, removed);
    this.activeLayer = activeLayerAfterRemove(this.activeLayer, removed, this.doc.layers.length);
    this.touched = true;
  }

  /**
   * Moves a layer; the moved layer keeps the selection. Unlike the frame
   * operations this is allowed during playback: it changes no frame index,
   * only what the composite shows — and a drag cancelled after playback
   * started must be able to put the layer back.
   */
  moveLayerTo(from: number, to: number): void {
    if (from === to || to < 0 || to >= this.doc.layers.length) {
      return;
    }
    moveLayer(this.doc, from, to);
    this.activeLayer = activeLayerAfterMove(this.activeLayer, from, to);
    this.touched = true;
  }

  toggleLayerHidden(index: number): void {
    const layer = this.doc.layers[index];
    if (!layer) {
      return;
    }
    setLayerHidden(this.doc, index, !layer.hidden);
    this.touched = true;
  }

  setPickSource(source: PickSource): void {
    this.pickSource = source;
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

  /** Onion layers for the canvas: fading neighbors, or Tonio's visited frames. */
  get onionSkinLayers(): OnionLayer[] {
    return this.ux.onionMode === 'history'
      ? onionHistoryLayers(this.visitedFrames, this.activeFrame, frameCount(this.doc))
      : onionLayers(this.activeFrame, frameCount(this.doc), ONION_SKIN_ALPHAS, this.ux.onionSides);
  }

  toggleOnionSkin(): void {
    this.onionSkin = !this.onionSkin;
  }

  /** Zoom around the canvas center — the toolbar has no pointer to zoom at. */
  zoomBy(delta: number): void {
    const { width, height } = this.viewSize;
    this.view = zoomAt(this.view, this.view.zoom + delta, width / 2, height / 2, width, height);
  }

  /**
   * Opens a saved draft: the full reset of an import, but not an edit — the
   * record already exists, so `touched` stays as it was.
   */
  openDraft(doc: ToonDocument): void {
    this.replaceDoc(doc);
    this.visitedFrames = [0];
    this.erases = [];
    this.touched = false;
  }

  /** A clean sheet: nothing to autosave until the first edit. */
  newDocument(): void {
    this.openDraft(createDocument({ frameRate: this.ux.defaultFps }));
  }

  /**
   * Opens an imported document: like a loaded draft, but it *is* an edit —
   * the local draft must keep it, so the document counts as touched.
   */
  importDoc(doc: ToonDocument): void {
    this.openDraft(doc);
    this.touched = true;
  }

  /** Back to 100% with the document centered in the canvas. */
  resetView(): void {
    this.view = { ...IDENTITY_VIEW };
  }

  /** Replaces the document (restored draft); not a user edit, so `touched` stays as is. */
  replaceDoc(doc: ToonDocument): void {
    this.doc = doc;
    this.resetView();
    this.activeFrame = 0;
    this.activeLayer = 0;
    this.playing = false;
    this.playbackFrame = 0;
    this.undone = [];
  }

  selectFrame(index: number): void {
    if (this.playing || index < 0 || index >= frameCount(this.doc)) {
      return;
    }
    this.activeFrame = index;
    this.visitedFrames = [...this.visitedFrames, index].slice(-ONION_HISTORY_LENGTH);
  }

  addFrameAfterActive(): void {
    if (this.playing || frameCount(this.doc) >= MAX_FRAMES) {
      return;
    }
    this.activeFrame = addFrame(this.doc, this.activeFrame);
    this.touched = true;
  }

  /** Ctrl+add in the reference: a new empty frame in front of the current one. */
  addFrameBeforeActive(): void {
    if (this.playing || frameCount(this.doc) >= MAX_FRAMES) {
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
    this.activeFrame = activeFrameAfterRemove(this.activeFrame, frameCount(this.doc), this.ux.afterRemove);
    this.touched = true;
  }

  setFps(value: number): void {
    setFrameRate(this.doc, clampPlayerFps(value, this.ux.fpsRange));
    this.touched = true;
  }

  /** Copies the active frame across every layer to the clipboard (deep copy). */
  copyActiveFrame(): void {
    this.copiedColumn = cloneColumn(this.doc, this.activeFrame);
    this.flashTick++;
  }

  /** Pastes the clipboard column onto the active frame, replacing every layer's cell. */
  pasteFrame(): void {
    if (this.playing || !this.copiedColumn) {
      return;
    }
    try {
      replaceColumn(this.doc, this.activeFrame, this.copiedColumn);
      this.touched = true;
      this.flashTick++;
    } catch (err) {
      // At the document point limit — drop the paste instead of throwing.
      console.warn('paste rejected:', err);
    }
  }

  /** The cell the next stroke goes into — undo and redo both work on it. */
  get activeCell(): Frame | undefined {
    return this.doc.layers[this.activeLayer]?.frames[this.activeFrame];
  }

  /** The mega-eraser cut undo would put back, if the cell is still as it left it. */
  get restorableErase(): { cell: Frame; strokes: Stroke[]; after: number } | undefined {
    const top = this.erases[this.erases.length - 1];
    return top !== undefined && top.cell === this.activeCell && top.after === this.activeCell?.strokes.length
      ? top
      : undefined;
  }

  get canUndo(): boolean {
    return !this.playing
      && ((this.activeCell?.strokes.length ?? 0) > 0 || this.restorableErase !== undefined);
  }

  /**
   * Redo is offered only for the cell the stroke was undone from. The entry
   * remembers the cell itself, not its index, so a frame added, removed or
   * pasted over retires its redo entries for free — the cell object is simply
   * no longer the active one.
   */
  get canRedo(): boolean {
    const last = this.undone[this.undone.length - 1];
    return !this.playing && last !== undefined && last.cell === this.activeCell;
  }

  /** Undo: drops the last stroke of the active layer's cell and keeps it for redo. */
  undo(): void {
    if (!this.canUndo) {
      return;
    }
    // ponytail: a mega-eraser cut is undoable but not redoable — restoring it
    // retires the redo stack. Give it a redo entry if anyone asks for one.
    const erase = this.restorableErase;
    if (erase) {
      this.erases.pop();
      replaceStrokes(this.doc, this.activeLayer, this.activeFrame, erase.strokes);
      this.undone = [];
      this.touched = true;
      return;
    }
    const cell = this.activeCell!;
    const stroke = cell.strokes[cell.strokes.length - 1];
    if (!removeLastStroke(this.doc, this.activeLayer, this.activeFrame)) {
      return;
    }
    this.undone.push({ cell, stroke });
    if (this.undone.length > UNDO_HISTORY_LIMIT) {
      this.undone.shift();
    }
    this.touched = true;
  }

  /** Redo: puts the last undone stroke back where it came from. */
  redo(): void {
    if (!this.canRedo) {
      return;
    }
    const { stroke } = this.undone.pop()!;
    // The tool is still interned, so this resolves to the same tool_id.
    addStroke(this.doc, this.activeLayer, this.activeFrame, {
      points: stroke.points,
      tool: this.doc.tools[stroke.tool_id],
    });
    this.touched = true;
  }

  /**
   * Appends a finished stroke to the active frame. The one place strokes
   * enter the document, so it is also the one place a fresh stroke retires
   * the redo stack.
   */
  commitStroke(layerIndex: number, stroke: ResolvedStroke): void {
    addStroke(this.doc, layerIndex, this.activeFrame, stroke);
    this.undone = [];
    this.touched = true;
  }

  /**
   * Mega eraser: cuts the active cell's strokes with the gesture capsule.
   * Records the previous contents for undo and does nothing when the gesture
   * missed everything.
   */
  applyMegaEraser(gesture: readonly number[], radius: number): void {
    const cell = this.activeCell;
    if (this.playing || !cell || this.activeLayerHidden) {
      return;
    }
    const before = cell.strokes;
    const after = eraseStrokes(before, gesture, radius);
    if (after.length === before.length
      && after.every((piece, i) => piece.points.length === before[i].points.length)) {
      return;
    }
    this.erases.push({
      cell,
      strokes: before.map((stroke) => ({ points: stroke.points.slice(), tool_id: stroke.tool_id })),
      after: after.length,
    });
    replaceStrokes(this.doc, this.activeLayer, this.activeFrame, after);
    this.erases[this.erases.length - 1].cell = this.activeCell!;
    this.undone = [];
    this.touched = true;
  }

  /** Grows the brush by the profile's step (+ hotkey), up to its maximum. */
  increaseBrushSize(): void {
    this.brushSizeLogical = nudgeBrushSize(this.brushSizeLogical, 1, this.ux);
  }

  /** Shrinks the brush by the profile's step (- hotkey), down to the minimum. */
  decreaseBrushSize(): void {
    this.brushSizeLogical = nudgeBrushSize(this.brushSizeLogical, -1, this.ux);
  }

  toggleOldschool(): void {
    this.oldschool = !this.oldschool;
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
        pickSource: this.pickSource,
      },
    });
  }
}
