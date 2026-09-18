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
  copyCells,
  createDocument,
  frameCount,
  insertFrameBefore,
  mergeCells,
  moveLayer,
  removeFrame,
  removeLastStroke,
  removeLayer,
  replaceCells,
  replaceColumn,
  replaceStrokes,
  setFrameRate,
  setLayerHidden,
  type CellBuffer,
  type CellRange,
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
  pasteTarget,
  rangeSelection,
  toggleLayerInSelection,
  type CellSelection,
  type OnionLayer,
  type PickSource,
} from './frame-selection';
import {
  addPaletteColor,
  loadPalette,
  loadSavedPalettes,
  mergePalettes,
  PALETTE_LIMIT,
  removePaletteColor,
  savePalette,
  saveSavedPalettes,
  withSavedPalette,
  type SavedPalette,
} from './color-palette';
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
  TIMELINE_HEIGHT_MAX,
  TIMELINE_HEIGHT_MIN,
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

/** One cell of a block edit, as it was before the edit ran. */
interface CellSnapshot {
  /** The cell object the edit produced — identity is how undo knows it is untouched. */
  cell: Frame;
  layer: number;
  frame: number;
  /** What the cell held before. Tool ids stay valid: the tool table only grows. */
  strokes: Stroke[];
  /** Stroke count the edit left behind. */
  after: number;
}

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
  /** Reference `toonio_saved_palettes`: named snapshots of the grid. */
  savedPalettes = $state<SavedPalette[]>(loadSavedPalettes());
  /** Canvas zoom and pan; view state only, never part of the document. */
  view = $state<Viewport2D>({ ...IDENTITY_VIEW });
  /** Canvas size in CSS px, kept current by CanvasView — zoom clamps against it. */
  viewSize = $state({ width: CANVAS_LOGICAL_WIDTH, height: CANVAS_LOGICAL_HEIGHT });
  /**
   * Cell contents captured before a block edit — a mega-eraser cut, a paste,
   * a merge — newest last, one entry per undoable operation. `after` is the
   * stroke count the edit left behind, so a stroke drawn on top is undone
   * first and the snapshot only comes back when the cells are in the state
   * the edit produced.
   */
  edits = $state<CellSnapshot[][]>([]);
  /** Strokes taken off by undo, newest last — what redo puts back. */
  undone = $state<{ cell: Frame; stroke: Stroke }[]>([]);
  /** Clipboard for frame copy/paste: every layer's cell, deep-copied on copy. */
  copiedColumn = $state<ResolvedColumn | null>(null);
  /** Timeline cells the user has selected; a plain click leaves one. */
  selection = $state<CellSelection>({ frames: [0], layers: [0] });
  /** Clipboard for the timeline block copy/paste, deep-copied on copy. */
  copiedCells = $state<CellBuffer | null>(null);
  /** Where the buffer was taken from — the timeline marks those cells. */
  copiedFrom = $state<CellSelection | null>(null);
  /** Studio timeline height in CSS px (persisted), set by dragging its divider. */
  timelineHeight = $state(DEFAULT_DRAWING_UI_CONFIG.timelineHeight);
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
      this.timelineHeight = saved.drawing.timelineHeight;
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

  /** Keeps a color in the saved grid (reference AddColourToPalette). */
  addColorToPalette(color: string): void {
    this.palette = addPaletteColor(this.palette, color);
    savePalette(this.palette);
  }

  /** Keeps the current brush color in the saved grid (reference: «добавить в палитру»). */
  addCurrentColorToPalette(): void {
    this.addColorToPalette(this.brushColor);
  }

  /**
   * A picked color lands on the outline (left button) or the fill (right
   * button) — reference PickColour / OnPickColour. An eraser gives way to the
   * pencil; other tools keep drawing. A pick from outside the grid (pipette,
   * browser eyedropper) is also kept in the grid, the reference's
   * `paletteAutoAdd` default.
   */
  pickColor(color: string, target: 'outline' | 'fill', fromGrid = false): void {
    const hex = color.toLowerCase();
    if (this.tool === 'eraser' || this.tool === 'mega-eraser') {
      this.tool = 'pencil';
    }
    if (target === 'fill') {
      this.fillColor = hex;
    } else {
      this.setBrushColor(hex);
    }
    if (!fromGrid && this.ux.colorGrid) {
      this.addColorToPalette(hex);
    }
  }

  removePaletteColor(color: string): void {
    this.palette = removePaletteColor(this.palette, color);
    savePalette(this.palette);
  }

  /** Reference LoadPalette(colours, true): the grid becomes exactly these colors. */
  replacePalette(colours: readonly string[]): void {
    this.palette = colours.map((c) => c.toLowerCase()).slice(0, PALETTE_LIMIT);
    savePalette(this.palette);
  }

  /** Reference MergePalette: adds what the grid lacks; returns the counts for the UI to report. */
  mergePalette(colours: readonly string[]): { added: number; skipped: number } {
    const merged = mergePalettes(this.palette, colours, PALETTE_LIMIT);
    this.palette = merged.palette;
    savePalette(this.palette);
    return merged;
  }

  saveCurrentPalette(name: string): void {
    this.savedPalettes = withSavedPalette(this.savedPalettes, name, this.palette);
    saveSavedPalettes(this.savedPalettes);
  }

  deleteSavedPalette(id: number): void {
    this.savedPalettes = this.savedPalettes.filter((p) => p.id !== id);
    saveSavedPalettes(this.savedPalettes);
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
      this.selection = { frames: [this.activeFrame], layers: [index] };
    }
  }

  /** How far the document reaches, in timeline cells. */
  get cellBounds(): { frames: number; layers: number } {
    return { frames: frameCount(this.doc), layers: this.doc.layers.length };
  }

  /**
   * A timeline cell click. 'set' moves the active cell and collapses the
   * selection onto it; 'range' (Shift) spans from the active cell to this
   * one; 'toggle' (Ctrl) adds or removes this layer, leaving the active cell
   * where it is.
   */
  selectCell(frame: number, layer: number, mode: 'set' | 'range' | 'toggle' = 'set'): void {
    if (this.playing) {
      return;
    }
    if (mode === 'range') {
      this.selection = rangeSelection(
        { frame: this.activeFrame, layer: this.activeLayer },
        { frame, layer },
        this.cellBounds,
      );
      return;
    }
    if (mode === 'toggle') {
      this.selection = toggleLayerInSelection(this.selection, layer);
      return;
    }
    this.selectFrame(frame);
    this.selectLayer(layer);
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
    this.edits = [];
    this.touched = false;
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
    this.selection = { frames: [0], layers: [0] };
    this.copiedCells = null;
    this.copiedFrom = null;
  }

  selectFrame(index: number): void {
    if (this.playing || index < 0 || index >= frameCount(this.doc)) {
      return;
    }
    this.activeFrame = index;
    this.selection = { frames: [index], layers: [this.activeLayer] };
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

  /** Copies every selected cell to the timeline clipboard (deep copy). */
  copySelection(): void {
    this.copiedCells = copyCells(this.doc, this.selection);
    this.copiedFrom = this.selection;
    this.flashTick++;
  }

  get canPasteCells(): boolean {
    return !this.playing && this.copiedCells !== null;
  }

  /** V: the buffer replaces the cells it lands on. */
  pasteSelection(): void {
    this.applyCopiedCells(replaceCells);
  }

  /** M: the buffer's strokes land on top of what the cells already hold. */
  mergeSelection(): void {
    this.applyCopiedCells(mergeCells);
  }

  private applyCopiedCells(write: typeof replaceCells): void {
    const buffer = this.copiedCells;
    if (!this.canPasteCells || !buffer) {
      return;
    }
    const target = pasteTarget(
      { frames: buffer[0]?.length ?? 0, layers: buffer.length },
      { frame: this.activeFrame, layer: this.activeLayer },
      this.cellBounds,
    );
    const snapshots = this.snapshotCells(target);
    try {
      write(this.doc, target, buffer);
    } catch (err) {
      // At the document point limit — drop the write instead of throwing.
      console.warn('timeline paste rejected:', err);
      return;
    }
    this.pushEdit(snapshots);
    this.selection = target;
    this.flashTick++;
  }

  setTimelineHeight(px: number): void {
    this.timelineHeight = Math.min(TIMELINE_HEIGHT_MAX, Math.max(TIMELINE_HEIGHT_MIN, Math.round(px)));
    this.persistUiConfig();
  }

  /** Cell contents as they are now, to be pushed once the edit has run. */
  private snapshotCells(target: CellRange): CellSnapshot[] {
    const snapshots: CellSnapshot[] = [];
    for (const layer of target.layers) {
      for (const frame of target.frames) {
        const cell = this.doc.layers[layer].frames[frame];
        snapshots.push({
          cell,
          layer,
          frame,
          strokes: cell.strokes.map((s) => ({ points: s.points.slice(), tool_id: s.tool_id })),
          after: 0,
        });
      }
    }
    return snapshots;
  }

  /**
   * Files a finished block edit as one undo step. The written cells are fresh
   * objects, so the snapshot takes them (and their stroke counts) after the
   * write — that pair is what tells undo the cells are untouched since.
   */
  private pushEdit(snapshots: CellSnapshot[]): void {
    for (const snapshot of snapshots) {
      snapshot.cell = this.doc.layers[snapshot.layer].frames[snapshot.frame];
      snapshot.after = snapshot.cell.strokes.length;
    }
    this.edits.push(snapshots);
    if (this.edits.length > UNDO_HISTORY_LIMIT) {
      this.edits.shift();
    }
    this.undone = [];
    this.touched = true;
  }

  /** The cell the next stroke goes into — undo and redo both work on it. */
  get activeCell(): Frame | undefined {
    return this.doc.layers[this.activeLayer]?.frames[this.activeFrame];
  }

  /**
   * The block edit undo would put back, if every cell it wrote is still as it
   * left it and the user is standing on one of them.
   */
  get restorableEdit(): CellSnapshot[] | undefined {
    const top = this.edits[this.edits.length - 1];
    if (!top) {
      return undefined;
    }
    const intact = top.every((s) => {
      const cell = this.doc.layers[s.layer]?.frames[s.frame];
      return cell === s.cell && cell.strokes.length === s.after;
    });
    return intact && top.some((s) => s.cell === this.activeCell) ? top : undefined;
  }

  get canUndo(): boolean {
    return !this.playing
      && ((this.activeCell?.strokes.length ?? 0) > 0 || this.restorableEdit !== undefined);
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
    // ponytail: a block edit is undoable but not redoable — restoring it
    // retires the redo stack. Give it a redo entry if anyone asks for one.
    const edit = this.restorableEdit;
    if (edit) {
      this.edits.pop();
      for (const snapshot of edit) {
        replaceStrokes(this.doc, snapshot.layer, snapshot.frame, snapshot.strokes);
      }
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
    const snapshots = this.snapshotCells({ frames: [this.activeFrame], layers: [this.activeLayer] });
    replaceStrokes(this.doc, this.activeLayer, this.activeFrame, after);
    this.pushEdit(snapshots);
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
        timelineHeight: this.timelineHeight,
      },
    });
  }
}
