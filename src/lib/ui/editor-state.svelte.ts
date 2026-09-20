/**
 * Reactive editor state: Svelte 5 runes over the plain model.
 * Document mutations go through model operations only.
 */

import { AudioTrackState } from '../audio/state.svelte';
import type { DraftState } from '../draft/store';
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
  ONION_SKIN_ALPHAS,
} from '../format/constants';
import {
  addFrame,
  addLayer,
  pasteNeedsConfirm,
  renameLayer,
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
  mirrorCell,
  transformStrokes,
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
  scaleMenuVisible,
  SCALE_MENU_MS,
  keepsSelection,
  newLayerIndex,
  pasteTargetFromSelection,
  pushVisited,
  shiftVisited,
  rangeSelection,
  toggleLayerInSelection,
  type CellSelection,
  type OnionLayer,
  type PickSource,
} from './frame-selection';
import {
  addPaletteColor,
  exportPalettes,
  importPalettes,
  loadPalette,
  loadSavedPalettes,
  mergePalettes,
  removePaletteColor,
  savePalette,
  saveSavedPalettes,
  stealPalette,
  uniqueColours,
  withSavedPalette,
  type SavedPalette,
} from './color-palette';
import { IDENTITY_VIEW, clampPan, fitView, zoomAt, type Stage, type Viewport2D } from './viewport';
import { LAYER_TAGS, defaultLayerColors, normalizeLayerColors } from './layer-colors';
import { eraseStrokes } from '../tools/mega-eraser';
import type { TransformSession } from '../tools/lasso';
import {
  EMPTY_TRANSFORM,
  nudged,
  selectionBounds,
  sessionMatrix,
  sessionWidthScale,
} from '../tools/lasso';
import { distortRate, jitter } from '../tools/distort';
import { TONIO_CANVAS_WIDTH } from '../tools/profiles';
import type { Box } from '../model/geom';
import { applyMatrix, clampCoord } from '../model/geom';

/** An open transform: the cells the lasso took and how far they have been moved. */
export interface TransformState {
  /** Layers whose whole cell at the active frame is selected. */
  layers: number[];
  /** Bounds of the selection when it was made — the frame the handles sit on. */
  box: Box;
  session: TransformSession;
  widthWithScale: boolean;
  /** Steps inside the session, oldest first — the window's own undo. */
  past: TransformSession[];
  future: TransformSession[];
}
import {
  nudgeBrushSize,
  isHelpTool,
  resolveToolSelection,
  toolAfterColorChange,
  toolAfterHelp,
  type SelectableTool,
  type UxProfile,
} from './ux-profile';
import {
  CURRENT_NAME,
  exportWorkspace,
  importWorkspaces,
  loadWorkspaces,
  removeWorkspace,
  saveWorkspaces,
  withWorkspace,
  type Workspace,
} from './workspaces';
import {
  anyToolVisible,
  hidePanelItem,
  movePanelItem,
  visibleTools,
  panelItemVisible,
  showPanelItem,
  type PanelLayout,
  type PanelSlot,
} from './panels';
import {
  DEFAULT_PRESET,
  DEFAULT_DRAWING_UI_CONFIG,
  BRUSH_TOOLS,
  brushToolOf,
  DEFAULT_SETTINGS,
  loadUiConfig,
  presetDrawingProfile,
  presetPanels,
  presetUx,
  saveUiConfig,
  PANEL_HEIGHT_MAX,
  PANEL_HEIGHT_MIN,
  SIDE_WIDTH_MAX,
  SIDE_WIDTH_MIN,
  type BrushToolId,
  type DrawingProfileId,
  type EditorSettings,
  type SideId,
  type TonioBrush,
} from './presets';

export type Tool = SelectableTool;

/** Fresh brush records, so a load or a save never shares objects with the config. */
function copyBrushes(source: Record<BrushToolId, TonioBrush>): Record<BrushToolId, TonioBrush> {
  return BRUSH_TOOLS.reduce((all, tool) => {
    all[tool] = { ...source[tool] };
    return all;
  }, {} as Record<BrushToolId, TonioBrush>);
}

/**
 * Steps kept inside one transform session. A drag writes one per pointermove,
 * so this is a ring, not a full history — enough to walk back out of a bad
 * rotation, bounded so a long drag cannot grow without end.
 */
const TRANSFORM_HISTORY_LIMIT = 100;
/** The distort brush writes once every this many pixels of the reference canvas. */
const DISTORT_STEP_PX = 5;

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
  /** The one soundtrack: file, credits, envelope for the strip, playback. */
  readonly audio = new AudioTrackState();
  tool = $state<Tool>('pencil');
  /** What was drawing before a help tool (pipette, hand, lasso, distort) took over. */
  previousDrawingTool = $state<Tool>('pencil');
  /**
   * Whether the mega-eraser has already warned this session. Session state,
   * not a setting: the reference warns again in the next tab.
   */
  megaEraserWarned = $state(false);
  /** The open lasso/distort session; null when nothing is selected. */
  transform = $state<TransformState | null>(null);
  /** Reference checkbox: the stroke width follows the scale. Sticky across selections. */
  transformWidthWithScale = $state(false);
  /** Live distort drag: the cells as they were on press, where it started, last step written. */
  private distortGesture:
    { snapshots: CellSnapshot[]; startX: number; lastStep: number } | null = null;
  /**
   * The reference's settings window, persisted with the rest of the UI config.
   * Everything here applies the moment it changes.
   */
  settings = $state<EditorSettings>({ ...DEFAULT_SETTINGS });
  /**
   * Reference "paranoid mode": instead of applying an unfinished transform on
   * the way out, block the move until it is applied or dropped.
   */
  get transformLock(): boolean {
    return this.settings.lockTransform;
  }
  doc = $state(createDocument());
  activeFrame = $state(0);
  /** Layer the next stroke goes into; UI state, not part of the document. */
  activeLayer = $state(0);
  playing = $state(false);
  /** Frame shown while playback is running. */
  playbackFrame = $state(0);
  drawingProfile = $state<DrawingProfileId>(presetDrawingProfile(DEFAULT_PRESET));
  multatorBrushSizeLogical = $state(DEFAULT_BRUSH_SIZE_LOGICAL);
  /**
   * Tonio width, smoothing and minimum per tool: the reference keeps a brush
   * for the pencil, the eraser, the feather and the mega-eraser, and picking
   * a tool puts its own numbers back in the sliders.
   */
  tonioByTool = $state<Record<BrushToolId, TonioBrush>>(copyBrushes(DEFAULT_DRAWING_UI_CONFIG.tonioByTool));
  brushColor = $state(DEFAULT_BRUSH_COLOR);
  /** Second color: the feather fills with it, the pipette takes it on right-click. */
  fillColor = $state(DEFAULT_FILL_COLOR);
  /** Onion-skin toggle; ignored during playback. */
  onionSkin = $state(true);
  /**
   * Frames the user has *left* — Tonio's onion is built from these, so the
   * ghosts trail the cursor. Empty on open: one frame change leaves one ghost.
   */
  visitedFrames = $state<number[]>([]);
  /** Saved color grid (Tonio preset); persisted separately from the UI config. */
  palette = $state<string[]>(loadPalette());
  /** Cell a full grid overwrites next (reference AddColourToPalette's ring). */
  paletteCursor = $state(0);
  /**
   * Errors the session has seen, for Alt+L (`bundle:11407-11409`). Capped, so
   * a loop that throws every frame cannot grow the tab out of memory.
   */
  readonly errorLog: string[] = [];
  /** Reference `toonio_saved_palettes`: named snapshots of the grid. */
  savedPalettes = $state<SavedPalette[]>(loadSavedPalettes());
  /** Canvas zoom and pan; view state only, never part of the document. */
  view = $state<Viewport2D>({ ...IDENTITY_VIEW });
  /**
   * The worktable in CSS px — the workspace and the sheet lying on it, kept
   * current by CanvasView. Zoom and pan clamp against it.
   */
  stage = $state<Stage>({
    width: CANVAS_LOGICAL_WIDTH,
    height: CANVAS_LOGICAL_HEIGHT,
    sheetWidth: CANVAS_LOGICAL_WIDTH,
    sheetHeight: CANVAS_LOGICAL_HEIGHT,
  });
  /**
   * Where the cursor last was over the canvas, CSS px. The reference zooms
   * its buttons, slider and `+`/`-` around that point rather than the middle
   * of the canvas, so the place being worked on stays under the hand.
   */
  lastScalePivot = $state<{ x: number; y: number } | null>(null);
  /** When the zoom window stops showing itself after a wheel zoom, ms epoch. */
  scaleMenuUntil = $state(0);
  private scaleMenuTimer = 0;
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
  /** Cells of that block already drawn into, as `frame:layer` — their mark is out. */
  copiedDrawnInto = $state<string[]>([]);
  /**
   * Names the next new layer takes (reference `layerIterator`): a running
   * count for the session, seeded from the open document so the first new
   * layer of a three-layer drawing is «Слой 4». Not stored in the document.
   */
  layerCounter = $state(1);
  /**
   * The colour tag of each layer, one entry per layer, bottom-up like
   * `doc.layers`. Session state: the format has no field for it, so it travels
   * in the draft record and not in a published document.
   */
  layerColors = $state<number[]>(defaultLayerColors(1));
  /**
   * Studio bottom-panel height in CSS px (persisted), set by dragging the
   * divider on its top edge. The timeline is the row that grows with it.
   */
  panelHeight = $state(DEFAULT_DRAWING_UI_CONFIG.panelHeight);
  /**
   * The two studio side columns (persisted): the width each was dragged to,
   * and whether it is folded away to its arrow strip.
   */
  sides = $state(structuredClone(DEFAULT_DRAWING_UI_CONFIG.sides));
  /** The bottom bar folded away to its strip (persisted). */
  panelCollapsed = $state(DEFAULT_DRAWING_UI_CONFIG.panelCollapsed);
  /**
   * Which swatch the pipette fills. A plain pick arms the outline; the right
   * button on the palette's pipette arms the fill (`bundle:7009-7016`), and
   * the right button on the canvas still overrides it for one click.
   */
  pipetteTarget = $state<'outline' | 'fill'>('outline');
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
   * profile only; Tonio strokes ignore it. The egg and the settings sheet
   * are two doors into the same option.
   */
  get oldschool(): boolean {
    return this.settings.mouseMode;
  }
  /** When the draft was last written, for the panel's «Сохранено HH:MM». */
  lastSavedAt = $state<number | null>(null);
  /**
   * Reference Alt+Enter: mutes the «точно удалить?» confirmations for this
   * session. Deliberately not persisted — a muted warning should not outlive
   * the sitting that muted it.
   */
  warnings = $state(true);
  /**
   * How the editor asks before it overwrites. Editor.svelte points it at
   * `confirm`; in tests and on the share page nothing asks, so the default
   * says yes. `Alt+Enter` mutes every question for the session — see
   * `confirmed`.
   */
  ask: (message: string) => boolean = () => true;
  /** Set once the user changes the document — gates autosave and draft restore. */
  touched = $state(false);
  /** Title the opened `.toon` carried (reference «имя оригинала»); '' when none. */
  original = $state('');
  /** Set by the transport so a write deferred by playback lands on stop. */
  onStop: (() => void) | null = null;

  /** Active UI preset id (persisted). */
  preset = $state(DEFAULT_PRESET);
  /**
   * What sits in each panel, in what order (persisted). This is the whole of
   * button visibility: an item is offered exactly when a panel holds it. The
   * same arrangement whatever the preset — a preset changes how the editor
   * behaves (the brush above all), not where the keys are.
   */
  panels = $state<PanelLayout>(presetPanels(DEFAULT_PRESET));

  /**
   * Arrange mode: the panels are being rearranged by hand, so every item is a
   * drag handle rather than a control. Session state — a mode, not a setting.
   */
  arranging = $state(false);
  /** Where each floating item sits, in stage coordinates (persisted). */
  floatPos = $state<Record<string, { x: number; y: number }>>({});
  /** Named arrangements, stored on their own key (they outlive a preset). */
  workspaces = $state<Workspace[]>([]);

  /** Whether any tool key at all is still placed (the brush row asks). */
  get hasToolKeys(): boolean {
    return anyToolVisible(this.panels);
  }

  /**
   * The tools this editor has right now: whatever the arrangement places. The
   * preset only chose where it started — a key put back by hand is a tool the
   * editor has, hotkeys included.
   */
  get availableTools(): SelectableTool[] {
    return visibleTools(this.panels);
  }

  constructor() {
    const saved = loadUiConfig();
    if (saved) {
      this.preset = saved.preset;
      this.panels = saved.panels;
      this.floatPos = saved.floatPos;
      this.drawingProfile = saved.drawing.activeProfile;
      this.multatorBrushSizeLogical = saved.drawing.multatorWidth;
      this.tonioByTool = copyBrushes(saved.drawing.tonioByTool);
      this.pickSource = saved.drawing.pickSource;
      this.panelHeight = saved.drawing.panelHeight;
      this.sides = saved.drawing.sides;
      this.panelCollapsed = saved.drawing.panelCollapsed;
      this.settings = saved.settings;
    }
    this.workspaces = loadWorkspaces();
    this.watchErrors();
    this.paletteExpanded = this.ux.quickPalette === null;
    this.doc = createDocument({ frameRate: this.ux.defaultFps });
    // The reference names every layer it creates, the first one included.
    // Without a name here the row falls back to its position, and the moment
    // a second layer slid in under it both rows would read «Слой 2».
    renameLayer(this.doc, 0, 'Слой 1');
  }

  /** Everything the session logs as an error, so Alt+L has something to hand over. */
  private watchErrors(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const note = (what: unknown): void => {
      if (this.errorLog.length >= 200) {
        this.errorLog.shift();
      }
      this.errorLog.push(`${new Date().toISOString()} ${what instanceof Error ? what.stack ?? what.message : String(what)}`);
    };
    window.addEventListener('error', (e) => note(e.error ?? e.message));
    window.addEventListener('unhandledrejection', (e) => note(e.reason));
    const wasError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      note(args.join(' '));
      wasError(...args);
    };
  }

  /** Behavior profile of the active preset (palette, eraser rule, onion side, frames, playback). */
  get ux(): UxProfile {
    return presetUx(this.preset);
  }

  /** Brush record of the active tool — what the sliders read and write. */
  get tonioBrush(): TonioBrush {
    return this.tonioByTool[brushToolOf(this.tool)];
  }

  get tonioBrushSizeLogical(): number {
    return this.tonioBrush.width;
  }

  get tonioSmooth(): number {
    return this.tonioBrush.smooth;
  }

  get tonioMinDistance(): number {
    return this.tonioBrush.minDistance;
  }

  get brushSizeLogical(): number {
    return this.drawingProfile === 'toonio' ? this.tonioBrushSizeLogical : this.multatorBrushSizeLogical;
  }

  set brushSizeLogical(value: number) {
    if (this.drawingProfile === 'toonio') {
      this.tonioBrush.width = Math.min(500, Math.max(1, Math.round(value)));
    } else {
      this.multatorBrushSizeLogical = Math.min(MAX_BRUSH_SIZE_LOGICAL, Math.max(MIN_BRUSH_SIZE_LOGICAL, Math.round(value)));
    }
    this.persistUiConfig();
  }

  setTonioSmooth(value: number): void {
    this.tonioBrush.smooth = Math.min(100, Math.max(1, Math.round(value)));
    this.persistUiConfig();
  }

  setTonioMinDistance(value: number): void {
    this.tonioBrush.minDistance = Math.min(30, Math.max(0, Math.round(value)));
    this.persistUiConfig();
  }

  /**
   * Switch to a preset, resetting toolbar visibility, its drawing profile and
   * UX defaults. An untouched document also takes the preset's frame rate;
   * work in progress keeps its own tempo.
   */
  applyPreset(id: string): void {
    this.preset = id;
    // A preset brings its own starting set — fewer keys under Multator, its
    // own colour widget — on the same panels.
    this.panels = presetPanels(id);
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
  selectTool(tool: Tool, pipetteTarget: 'outline' | 'fill' = 'outline'): void {
    const resolved = resolveToolSelection(
      tool,
      this.brushColor,
      this.ux,
      this.paletteExpanded,
      this.availableTools,
    );
    if (!resolved || !this.leaveTransform()) {
      return;
    }
    // The reference's lasso needs no gesture: picking it selects the frame on
    // every selected layer at once. With nothing to take it stays unpicked.
    if (resolved === 'lasso' && !this.beginTransform()) {
      return;
    }
    // A help tool is a detour, so the way back is kept — but only the first
    // one: hopping pipette → hand must not make the pipette the way back.
    if (isHelpTool(resolved) && !isHelpTool(this.tool)) {
      this.previousDrawingTool = this.tool;
    }
    this.tool = resolved;
    if (resolved === 'pipette') {
      this.pipetteTarget = pipetteTarget;
      this.openBrowserPicker();
    }
  }

  /**
   * Reference `Picker.Selected`: picking the pipette opens the browser's own
   * eyedropper, which reads anywhere on screen. Off by setting, and absent in
   * browsers without the API — the canvas pipette works either way.
   */
  private openBrowserPicker(): void {
    const eyeDropper = (globalThis as {
      EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
    }).EyeDropper;
    if (!this.settings.chromePicker || !eyeDropper) {
      return;
    }
    new eyeDropper().open().then(
      (result) => this.pickColor(result.sRGBHex, this.pipetteTarget),
      () => {},
    );
  }

  /** Leaves a help tool for whatever was drawing before it (reference `ResetHelpTool`). */
  resetHelpTool(): void {
    this.tool = toolAfterHelp(this.previousDrawingTool);
  }

  /**
   * Swaps outline and fill (reference: the `X` button between the two
   * swatches, `bundle:7786-7790`). An eraser has no colour to swap into, so
   * it gives way to the pencil, the same rule a pick from the grid follows.
   */
  swapColors(): void {
    const outline = this.brushColor;
    this.brushColor = this.fillColor;
    this.fillColor = outline;
    if (this.tool === 'eraser' || this.tool === 'mega-eraser') {
      this.tool = 'pencil';
    }
  }

  /** Keeps a color in the saved grid (reference AddColourToPalette). */
  addColorToPalette(color: string): void {
    const next = addPaletteColor(this.palette, color, this.settings.paletteLimit, this.paletteCursor);
    this.palette = next.palette;
    this.paletteCursor = next.cursor;
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
    if (!fromGrid && this.ux.colorGrid && this.settings.paletteAutoAdd) {
      this.addColorToPalette(hex);
    }
  }

  removePaletteColor(color: string): void {
    this.palette = removePaletteColor(this.palette, color);
    savePalette(this.palette);
  }

  /** Reference LoadPalette(colours, true): the grid becomes exactly these colors. */
  replacePalette(colours: readonly string[]): void {
    this.palette = uniqueColours(colours).slice(-this.settings.paletteLimit);
    this.paletteCursor = 0;
    savePalette(this.palette);
  }

  /** Reference MergePalette: adds what the grid lacks; returns the counts for the UI to report. */
  mergePalette(colours: readonly string[]): { added: number; skipped: number } {
    const merged = mergePalettes(this.palette, colours, this.settings.paletteLimit);
    this.palette = merged.palette;
    savePalette(this.palette);
    return merged;
  }

  saveCurrentPalette(name: string): void {
    this.savedPalettes = withSavedPalette(this.savedPalettes, name, this.palette);
    saveSavedPalettes(this.savedPalettes);
  }

  /** The reference's `palettes.json`. */
  exportSavedPalettes(): string {
    return exportPalettes(this.savedPalettes);
  }

  /** Reads such a file; returns how many palettes landed, for the sheet to report. */
  importSavedPalettes(raw: string): number {
    const { palettes, loaded } = importPalettes(this.savedPalettes, raw);
    this.savedPalettes = palettes;
    saveSavedPalettes(this.savedPalettes);
    return loaded;
  }

  /** «Удалить все» — the sheet asks first. */
  deleteAllSavedPalettes(): void {
    this.savedPalettes = [];
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

  /** Put an item in a panel, at `index` or at its end. */
  movePanelItem(id: string, slot: PanelSlot, index?: number): void {
    this.panels = movePanelItem(this.panels, id, slot, index);
    this.ensureActiveLayerVisible();
    this.persistUiConfig();
  }

  setFloatPos(id: string, x: number, y: number): void {
    this.floatPos = { ...this.floatPos, [id]: { x: Math.round(x), y: Math.round(y) } };
    this.persistUiConfig();
  }

  /** Put the whole arrangement back at once (a workspace, or an undone drag). */
  setPanels(panels: PanelLayout): void {
    this.panels = panels;
    this.ensureActiveLayerVisible();
    this.persistUiConfig();
  }

  /** Saves the arrangement under a name, replacing one of the same name. */
  saveWorkspace(name: string): void {
    this.workspaces = withWorkspace(
      this.workspaces,
      name.trim(),
      $state.snapshot(this.panels),
      $state.snapshot(this.floatPos),
    );
    saveWorkspaces(this.workspaces);
  }

  applyWorkspace(id: number): void {
    const workspace = this.workspaces.find((w) => w.id === id);
    if (!workspace) {
      return;
    }
    // A stored workspace is a runes proxy here, which structuredClone refuses:
    // snapshot it back to plain data before it becomes the live arrangement.
    const plain = $state.snapshot(workspace);
    this.floatPos = plain.floatPos;
    this.setPanels(plain.panels);
  }

  /** One arrangement as a file: the named one, or the live one by default. */
  exportWorkspace(id?: number): string {
    const picked = id === undefined ? undefined : this.workspaces.find((w) => w.id === id);
    const workspace = picked ? $state.snapshot(picked) : undefined;
    return exportWorkspace(
      workspace?.name ?? CURRENT_NAME,
      workspace?.panels ?? $state.snapshot(this.panels),
      workspace?.floatPos ?? $state.snapshot(this.floatPos),
    );
  }

  /** Reads such a file; returns how many arrangements landed, for the sheet. */
  importWorkspaces(raw: string): number {
    const { workspaces, loaded } = importWorkspaces(this.workspaces, raw);
    this.workspaces = workspaces;
    saveWorkspaces(this.workspaces);
    return loaded;
  }

  deleteWorkspace(id: number): void {
    this.workspaces = removeWorkspace(this.workspaces, id);
    saveWorkspaces(this.workspaces);
  }

  /** Back into the panel this layout keeps it in. */
  showPanelItem(id: string): void {
    this.panels = showPanelItem(this.panels, id);
    this.persistUiConfig();
  }

  /** Hidden ↔ back where this layout puts it. */
  togglePanelItem(id: string): void {
    this.panels = panelItemVisible(this.panels, id)
      ? hidePanelItem(this.panels, id)
      : showPanelItem(this.panels, id);
    this.ensureActiveLayerVisible();
    this.persistUiConfig();
  }

  /**
   * With the layers panel gone the user has no way to unhide a layer, so a
   * hidden active layer would be a dead canvas — make it visible again. The
   * other hidden layers stay hidden; this is a document change.
   */
  ensureActiveLayerVisible(): void {
    // The rows live on the timeline: with the timeline gone there is no way
    // to unhide a layer, so a hidden active one is a dead canvas.
    if (panelItemVisible(this.panels, 'timeline')) {
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
    if (index >= 0 && index < this.doc.layers.length && this.leaveTransform()) {
      if (!keepsSelection(this.selection, { frame: this.activeFrame, layer: index })) {
        this.selection = { frames: [this.activeFrame], layers: [index] };
      }
      this.activeLayer = index;
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
    if (this.playing || !this.leaveTransform()) {
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
      const toggled = toggleLayerInSelection(this.selection, { frame, layer }, this.activeLayer);
      if (toggled) {
        this.selection = toggled;
        return;
      }
      // Ctrl had nothing to say about this cell — the reference falls through
      // to a plain click rather than swallowing it.
    }
    this.selectFrame(frame);
    this.selectLayer(layer);
  }

  /**
   * Adds an empty layer where the preset puts it — under the active one in
   * Toonio (`bundle:8485-8487`), over it elsewhere — and makes it active.
   * Ctrl asks for the other side. The name follows the session counter, so
   * two layers never share one however the stack is reordered.
   */
  addLayerAtActive(ctrlKey = false): void {
    if (this.playing || this.doc.layers.length >= MAX_LAYERS) {
      return;
    }
    const at = newLayerIndex(this.activeLayer, this.ux.newLayerPosition, ctrlKey);
    this.activeLayer = addLayer(this.doc, at);
    this.layerColors.splice(at, 0, this.layerCounter % LAYER_TAGS);
    this.layerCounter++;
    renameLayer(this.doc, at, `Слой ${this.layerCounter}`);
    this.touched = true;
  }

  /** Whether a layer holds any stroke — the panel asks before deleting one that does. */
  layerHasStrokes(index: number): boolean {
    return this.doc.layers[index]?.frames.some((cell) => cell.strokes.length > 0) ?? false;
  }

  /** What the panel calls a layer: its stored name, or its position. */
  layerLabel(index: number): string {
    return this.doc.layers[index]?.name ?? `Слой ${index + 1}`;
  }

  /** Names a layer (double click in the panel); a blank name goes back to the position. */
  renameActiveLayer(index: number, name: string): void {
    if (this.playing || !this.doc.layers[index]) {
      return;
    }
    renameLayer(this.doc, index, name);
    this.touched = true;
  }

  removeActiveLayer(): void {
    if (this.playing || this.doc.layers.length <= 1) {
      return;
    }
    if (!this.confirmed(`Удалить «${this.layerLabel(this.activeLayer)}»?`)) {
      return;
    }
    const removed = this.activeLayer;
    removeLayer(this.doc, removed);
    this.layerColors.splice(removed, 1);
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
    this.layerColors.splice(to, 0, ...this.layerColors.splice(from, 1));
    this.activeLayer = activeLayerAfterMove(this.activeLayer, from, to);
    this.touched = true;
  }

  /** The swatch a row paints itself with; a layer added before this existed cycles. */
  layerColor(index: number): number {
    return this.layerColors[index] ?? index % LAYER_TAGS;
  }

  /** Click on the tag: the next of the six swatches. */
  cycleLayerColor(index: number): void {
    if (!this.doc.layers[index]) {
      return;
    }
    this.layerColors[index] = (this.layerColor(index) + 1) % LAYER_TAGS;
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

  /** Back to the arrangement this preset starts from. */
  resetPanels(): void {
    this.setPanels(presetPanels(this.preset));
  }

  /** The frame that should currently be on the canvas. */
  get displayedFrame(): number {
    return this.playing ? this.playbackFrame : this.activeFrame;
  }

  /** Whether onion-skin layers should currently render. */
  get showOnionSkin(): boolean {
    return onionSkinVisible(this.onionSkin, this.playing, this.tool);
  }

  /** Onion layers for the canvas: fading neighbors, or Tonio's visited frames. */
  get onionSkinLayers(): OnionLayer[] {
    return this.ux.onionMode === 'history'
      ? onionHistoryLayers(this.visitedFrames, this.activeFrame, frameCount(this.doc))
      : onionLayers(this.activeFrame, frameCount(this.doc), ONION_SKIN_ALPHAS, this.ux.onionSides);
  }

  /**
   * Which layers a ghost frame is drawn from. Tonio flattens every selected
   * layer into one ghost (`bundle:11035-11040`); the neighbor model shows the
   * active layer alone, so a static background is not painted twice.
   */
  get onionHistoryLayerIndices(): number[] {
    return this.ux.onionMode === 'history' ? [...this.selection.layers] : [this.activeLayer];
  }

  toggleOnionSkin(): void {
    this.onionSkin = !this.onionSkin;
  }

  /** The zoom window: up with the hand, and for a moment after a wheel zoom. */
  get scaleMenuVisible(): boolean {
    return scaleMenuVisible(this.tool, this.scaleMenuUntil, Date.now());
  }

  /** Raises the zoom window for the reference's two seconds (wheel zoom). */
  flashScaleMenu(): void {
    this.scaleMenuUntil = Date.now() + SCALE_MENU_MS;
    clearTimeout(this.scaleMenuTimer);
    // The deadline alone is not reactive — something has to wake the view up
    // once it passes.
    this.scaleMenuTimer = setTimeout(() => {
      this.scaleMenuUntil = 0;
    }, SCALE_MENU_MS) as unknown as number;
  }

  /** Zoom around the last cursor position, falling back to the canvas centre. */
  zoomBy(delta: number): void {
    const { width, height } = this.stage;
    const pivot = this.lastScalePivot ?? { x: width / 2, y: height / 2 };
    this.view = zoomAt(this.view, this.view.zoom + delta, pivot.x, pivot.y, this.stage);
  }

  /** Slides the view by CSS pixels (the hand's arrow keys), never losing the sheet. */
  panBy(dx: number, dy: number): void {
    this.view = clampPan(
      { zoom: this.view.zoom, panX: this.view.panX + dx, panY: this.view.panY + dy },
      this.stage,
    );
  }

  /**
   * Opens a saved draft: the full reset of an import, but not an edit — the
   * record already exists, so `touched` stays as it was.
   */
  openDraft(doc: ToonDocument): void {
    this.replaceDoc(doc);
    this.layerCounter = doc.layers.length;
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

  /**
   * Reference behaviour on opening a file: the grid takes the colours the
   * drawing uses, since the file carries no palette of its own.
   */
  stealPalette(doc: ToonDocument): void {
    this.palette = stealPalette(this.palette, doc, this.settings.paletteLimit);
    savePalette(this.palette);
  }

  /** Where the hand is, for the draft record to carry. */
  sessionState(): DraftState {
    const widths: Record<string, number> = {};
    const smooth: Record<string, number> = {};
    const minDistance: Record<string, number> = {};
    for (const id of BRUSH_TOOLS) {
      const brush = this.tonioByTool[id];
      widths[id] = brush.width;
      smooth[id] = brush.smooth;
      minDistance[id] = brush.minDistance;
    }
    widths.multator = this.multatorBrushSizeLogical;
    return {
      frame: this.activeFrame,
      layer: this.activeLayer,
      tool: this.tool,
      widths,
      smooth,
      minDistance,
      outline: this.brushColor,
      fill: this.fillColor,
      palette: this.palette.slice(),
      layerColors: this.layerColors.slice(),
    };
  }

  /** Puts it back after a draft is opened. Anything missing is left as it is. */
  restoreState(saved: DraftState): void {
    for (const id of BRUSH_TOOLS) {
      this.tonioByTool[id] = {
        width: saved.widths?.[id] ?? this.tonioByTool[id].width,
        smooth: saved.smooth?.[id] ?? this.tonioByTool[id].smooth,
        minDistance: saved.minDistance?.[id] ?? this.tonioByTool[id].minDistance,
      };
    }
    if (typeof saved.widths?.multator === 'number') {
      this.multatorBrushSizeLogical = saved.widths.multator;
    }
    if (saved.outline) {
      this.brushColor = saved.outline;
    }
    if (saved.fill) {
      this.fillColor = saved.fill;
    }
    if (Array.isArray(saved.palette) && saved.palette.length > 0) {
      // A record written by an older build may hold repeats; the grid is keyed
      // by colour, so they have to go before it is rendered.
      this.palette = uniqueColours(saved.palette);
      this.paletteCursor = 0;
      savePalette(this.palette);
    }
    this.layerColors = normalizeLayerColors(saved.layerColors, this.doc.layers.length);
    if (saved.tool) {
      this.selectTool(saved.tool as Tool);
    }
    this.selectFrame(saved.frame ?? 0);
    this.selectLayer(saved.layer ?? 0);
    this.persistUiConfig();
  }

  /** Back to 100% with the sheet centred on the worktable. */
  resetView(): void {
    this.view = fitView(this.stage);
  }

  /** Replaces the document (restored draft); not a user edit, so `touched` stays as is. */
  replaceDoc(doc: ToonDocument): void {
    this.doc = doc;
    this.layerColors = defaultLayerColors(doc.layers.length);
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
    if (this.playing || index < 0 || index >= frameCount(this.doc) || !this.leaveTransform()) {
      return;
    }
    this.visitedFrames = pushVisited(this.visitedFrames, this.activeFrame, index);
    if (!keepsSelection(this.selection, { frame: index, layer: this.activeLayer })) {
      this.selection = { frames: [index], layers: [this.activeLayer] };
    }
    this.activeFrame = index;
  }

  /**
   * Back to the single active cell. A block left over the frame you have just
   * left would still be what V pastes into, so every frame operation ends here.
   */
  collapseSelection(): void {
    this.selection = { frames: [this.activeFrame], layers: [this.activeLayer] };
  }

  addFrameAfterActive(): void {
    if (this.playing || frameCount(this.doc) >= MAX_FRAMES) {
      return;
    }
    const left = this.activeFrame;
    this.activeFrame = addFrame(this.doc, this.activeFrame);
    // The reference adds a frame by *selecting* it (`bundle:8584-8600`), so
    // the frame it came from goes into the onion history like any other move.
    // Without this the fresh cell showed no ghost of the drawing it follows.
    this.visitedFrames = pushVisited(this.visitedFrames, left, this.activeFrame);
    this.collapseSelection();
    this.touched = true;
  }

  /** Ctrl+add in the reference: a new empty frame in front of the current one. */
  addFrameBeforeActive(): void {
    if (this.playing || frameCount(this.doc) >= MAX_FRAMES) {
      return;
    }
    const left = this.activeFrame;
    this.activeFrame = insertFrameBefore(this.doc, this.activeFrame);
    // `AddHistory(prev, ctrl)`: the frame left goes in first, then every entry
    // shifts, because the insert pushed those cells one to the right. The cell
    // that was under `left` now lives at `left + 1` — where its ghost belongs.
    const recorded = pushVisited(this.visitedFrames, left);
    this.visitedFrames = shiftVisited(recorded, this.activeFrame);
    this.collapseSelection();
    this.touched = true;
  }

  /**
   * Whether Delete may take the frame. Toonio refuses the last one outright
   * (`bundle:8619-8644`); the other presets clear its cells instead.
   */
  get canRemoveFrame(): boolean {
    return this.ux.playbackRange === 'selection' ? frameCount(this.doc) > 1 : true;
  }

  removeActiveFrame(): void {
    if (this.playing || !this.canRemoveFrame) {
      return;
    }
    if (!this.confirmed(`Удалить кадр ${this.activeFrame + 1}?`)) {
      return;
    }
    const left = this.activeFrame;
    removeFrame(this.doc, this.activeFrame);
    this.activeFrame = activeFrameAfterRemove(this.activeFrame, frameCount(this.doc), this.ux.afterRemove);
    this.visitedFrames = pushVisited(this.visitedFrames, left, this.activeFrame);
    this.collapseSelection();
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
    this.copiedDrawnInto = [];
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

  /** One question, muted for the session by `Alt+Enter` (the reference's warnings flag). */
  private confirmed(message: string): boolean {
    return !this.warnings || this.ask(message);
  }

  private applyCopiedCells(write: typeof replaceCells): void {
    const buffer = this.copiedCells;
    if (!this.canPasteCells || !buffer) {
      return;
    }
    const target = pasteTargetFromSelection(this.selection, {
      frames: buffer[0]?.length ?? 0,
      layers: buffer.length,
    });
    // The reference asks before it overwrites, and asks a second time once
    // more than one cell is at stake (`bundle:8192-8250`).
    const { nonEmpty, frames, layers } = pasteNeedsConfirm(this.doc, target);
    if (nonEmpty) {
      if (!this.confirmed('Ячейки не пустые. Заменить их содержимое?')) {
        return;
      }
      if (
        (frames > 1 || layers > 1)
        && !this.confirmed(`Это затронет кадров: ${frames}, слоёв: ${layers}. Продолжить?`)
      ) {
        return;
      }
    }
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

  setPanelHeight(px: number): void {
    this.panelHeight = Math.min(PANEL_HEIGHT_MAX, Math.max(PANEL_HEIGHT_MIN, Math.round(px)));
    this.persistUiConfig();
  }

  setSideWidth(side: SideId, px: number): void {
    this.sides[side].width = Math.min(SIDE_WIDTH_MAX, Math.max(SIDE_WIDTH_MIN[side], Math.round(px)));
    this.persistUiConfig();
  }

  togglePanel(): void {
    this.panelCollapsed = !this.panelCollapsed;
    this.persistUiConfig();
  }

  toggleSide(side: SideId): void {
    this.sides[side].collapsed = !this.sides[side].collapsed;
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
    // Unbounded, like the reference's own buffer: a stroke off the stack is
    // still the one the document held a moment ago, not a second copy of it.
    this.undone.push({ cell, stroke });
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
    if (!this.ux.redoSurvivesStroke) {
      this.undone = [];
    }
    // The reference drops the "copied" mark off a cell as soon as it is drawn
    // into (`bundle:8143-8151`); the rest of the block keeps it.
    const key = `${this.activeFrame}:${layerIndex}`;
    if (this.copiedFrom && !this.copiedDrawnInto.includes(key)) {
      this.copiedDrawnInto = [...this.copiedDrawnInto, key];
    }
    this.touched = true;
  }

  /** Whether the timeline still marks this cell as copied from. */
  isCopiedCell(frame: number, layer: number): boolean {
    const from = this.copiedFrom;
    return (
      from !== null
      && from.frames.includes(frame)
      && from.layers.includes(layer)
      && !this.copiedDrawnInto.includes(`${frame}:${layer}`)
    );
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

  /**
   * Layers the lasso, the mirror and the distort all work on: the selected
   * layers that are actually visible. Hidden ones are skipped, the way a
   * stroke never lands on one.
   */
  private get visibleSelectedLayers(): number[] {
    return this.selection.layers.filter((layer) => this.doc.layers[layer] && !this.doc.layers[layer].hidden);
  }

  /**
   * H / Shift+H with nothing selected: reflects the current frame on every
   * selected layer about the canvas centre. One snapshot set, so one undo
   * step, and the frame selection collapses the way the reference's does.
   */
  mirrorSelectedLayers(axis: 'horizontal' | 'vertical'): void {
    const layers = this.visibleSelectedLayers
      .filter((layer) => (this.doc.layers[layer].frames[this.activeFrame]?.strokes.length ?? 0) > 0);
    if (this.playing || layers.length === 0) {
      return;
    }
    this.selection = { frames: [this.activeFrame], layers: this.selection.layers };
    const snapshots = this.snapshotCells({ frames: [this.activeFrame], layers });
    for (const layer of layers) {
      mirrorCell(this.doc, layer, this.activeFrame, axis);
    }
    this.pushEdit(snapshots);
  }

  /**
   * Writes a finished transform into the document: `map` runs against every
   * cell the session covers, between the snapshots and the undo entry, so
   * Enter is one step across all of them and Esc is none.
   */
  applyTransform(
    layers: readonly number[],
    map: (doc: ToonDocument, layer: number, frame: number) => void,
  ): void {
    if (this.playing || layers.length === 0) {
      return;
    }
    const snapshots = this.snapshotCells({ frames: [this.activeFrame], layers: [...layers] });
    for (const layer of layers) {
      map(this.doc, layer, this.activeFrame);
    }
    this.pushEdit(snapshots);
  }

  /**
   * Lasso (Q/S): the reference takes the whole frame on every selected layer
   * the moment the tool is picked — no polygon to trace. An empty selection
   * opens nothing, so the caller can leave the tool where it was.
   */
  beginTransform(): boolean {
    const layers = this.visibleSelectedLayers;
    const box = selectionBounds(layers.flatMap(
      (layer) => this.doc.layers[layer].frames[this.activeFrame]?.strokes ?? [],
    ));
    if (this.playing || !box) {
      this.transform = null;
      return false;
    }
    this.selection = { frames: [this.activeFrame], layers: this.selection.layers };
    this.transform = {
      layers,
      box,
      session: { ...EMPTY_TRANSFORM },
      widthWithScale: this.transformWidthWithScale,
      past: [],
      future: [],
    };
    return true;
  }

  /**
   * Replaces the accumulated transform — what the fields, the handles and the
   * hotkeys all write, so it is also the one place a session step is recorded.
   */
  setTransform(session: TransformSession): void {
    const open = this.transform;
    if (!open) {
      return;
    }
    this.transform = {
      ...open,
      session,
      past: [...open.past, open.session].slice(-TRANSFORM_HISTORY_LIMIT),
      future: [],
    };
  }

  get canUndoTransform(): boolean {
    return (this.transform?.past.length ?? 0) > 0;
  }

  get canRedoTransform(): boolean {
    return (this.transform?.future.length ?? 0) > 0;
  }

  /** One step back inside the open session; the document is not touched. */
  undoTransform(): void {
    const open = this.transform;
    const step = open?.past[open.past.length - 1];
    if (!open || !step) {
      return;
    }
    this.transform = {
      ...open,
      session: step,
      past: open.past.slice(0, -1),
      future: [...open.future, open.session],
    };
  }

  redoTransform(): void {
    const open = this.transform;
    const step = open?.future[open.future.length - 1];
    if (!open || !step) {
      return;
    }
    this.transform = {
      ...open,
      session: step,
      past: [...open.past, open.session],
      future: open.future.slice(0, -1),
    };
  }

  /** One keyboard step: arrows move, Q/W turn, +/- scale. */
  nudgeTransform(
    what: 'move' | 'rotate' | 'scale',
    dir: 1 | -1,
    shift: boolean,
    axis: 'x' | 'y' = 'x',
  ): void {
    if (this.transform) {
      this.setTransform(nudged(this.transform.session, what, dir, shift, axis));
    }
  }

  /** H / Shift+H inside a transform: mirrors the selection, not the cell. */
  mirrorTransform(axis: 'horizontal' | 'vertical'): void {
    const open = this.transform;
    if (!open) {
      return;
    }
    const { session } = open;
    this.setTransform(axis === 'horizontal'
      ? { ...session, scaleX: -session.scaleX }
      : { ...session, scaleY: -session.scaleY });
  }

  /** "Change width with scale" — remembered for the next selection too. */
  setTransformWidthWithScale(on: boolean): void {
    this.transformWidthWithScale = on;
    if (this.transform) {
      this.transform = { ...this.transform, widthWithScale: on };
    }
  }

  /** Where a selected point sits right now — what the overlay and preview draw. */
  transformPoint(x: number, y: number): [number, number] {
    const open = this.transform;
    return open ? applyMatrix(sessionMatrix(open.session, open.box), x, y) : [x, y];
  }

  /** Enter / "apply": writes the open transform as one undo step and closes it. */
  commitTransform(): void {
    const open = this.transform;
    if (!open) {
      return;
    }
    this.transform = null;
    const { session } = open;
    if (session.dx === 0 && session.dy === 0 && session.rotate === 0
      && session.scaleX === 1 && session.scaleY === 1) {
      return;
    }
    const widthScale = open.widthWithScale ? sessionWidthScale(session) : 1;
    const matrix = sessionMatrix(session, open.box);
    this.applyTransform(open.layers, (doc, layer, frame) =>
      transformStrokes(doc, layer, frame, null, matrix, widthScale));
  }

  /**
   * Distort (~): not a session but a destructive brush. The cells are
   * snapshotted on press, shaken in place on every accepted move, and filed
   * as one undo step on release (`tools.js` `Distort`).
   */
  beginDistort(x: number): void {
    const layers = this.visibleSelectedLayers;
    if (this.playing || layers.length === 0) {
      return;
    }
    this.distortGesture = {
      snapshots: this.snapshotCells({ frames: [this.activeFrame], layers }),
      startX: x,
      lastStep: NaN,
    };
  }

  /**
   * One accepted move of the distort drag. `x` is in document units; the
   * reference measures its strength on a 1280-wide canvas, so the travel goes
   * into reference pixels and the kick comes back out of them.
   */
  distortStep(x: number): void {
    const gesture = this.distortGesture;
    if (!gesture) {
      return;
    }
    // Everything here is measured on the reference's own 1280-wide canvas:
    // the strength, and the every-fifth-pixel throttle (`~~x % 5`). Counting
    // either in document units shakes the frame several times too often.
    const perDocUnit = TONIO_CANVAS_WIDTH / this.doc.width;
    const referenceX = x * perDocUnit;
    const step = Math.trunc(referenceX / DISTORT_STEP_PX);
    if (step === gesture.lastStep) {
      return;
    }
    gesture.lastStep = step;
    const rate = distortRate(referenceX, gesture.startX * perDocUnit) / perDocUnit;
    if (rate === 0) {
      return;
    }
    for (const { layer, frame } of gesture.snapshots) {
      // A fresh cell object, not a shake in place: that identity change is
      // what tells the canvas its buffers are stale.
      const shaken = this.doc.layers[layer].frames[frame].strokes.map((stroke) => ({
        points: jitter(stroke.points, rate).map(clampCoord),
        tool_id: stroke.tool_id,
      }));
      replaceStrokes(this.doc, layer, frame, shaken);
    }
    this.touched = true;
  }

  /** Pointer up: the whole shake becomes one undo step. */
  endDistort(): void {
    if (this.distortGesture) {
      this.pushEdit(this.distortGesture.snapshots);
      this.distortGesture = null;
    }
  }

  /**
   * Called before anything that would take the user off the open transform —
   * a frame, a layer or a tool change. The reference applies the transform
   * (`ApplyTransformFast`); with the lock on it refuses the move instead, and
   * returns false so the caller does nothing.
   */
  leaveTransform(): boolean {
    if (!this.transform) {
      return true;
    }
    if (this.transformLock) {
      return false;
    }
    this.commitTransform();
    return true;
  }

  /** Esc / "cancel": drops the session, leaving no undo entry behind. */
  cancelTransform(): void {
    this.transform = null;
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
    this.setSetting('mouseMode', !this.settings.mouseMode);
  }

  /** One settings option, applied and persisted at once. */
  setSetting<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void {
    this.settings = { ...this.settings, [key]: value };
    this.persistUiConfig();
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
      panels: $state.snapshot(this.panels),
      // Only the windows that are actually floating: a drag that passed over
      // the canvas must not leave a position behind for ever.
      floatPos: Object.fromEntries(
        this.panels.float.map((id) => [id, this.floatPos[id]]).filter(([, pos]) => pos),
      ) as Record<string, { x: number; y: number }>,
      drawing: {
        activeProfile: this.drawingProfile,
        multatorWidth: this.multatorBrushSizeLogical,
        tonioByTool: copyBrushes(this.tonioByTool),
        pickSource: this.pickSource,
        panelHeight: this.panelHeight,
        sides: $state.snapshot(this.sides),
        panelCollapsed: this.panelCollapsed,
      },
      settings: this.settings,
    });
  }
}
