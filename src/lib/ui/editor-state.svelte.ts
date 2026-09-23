/**
 * Reactive editor state: Svelte 5 runes over the plain model.
 * Document mutations go through model operations only.
 */

import { sessionErrors } from './error-log';
import { AudioTrackState } from '../audio/state.svelte';
import type { DraftState } from '../draft/store';
import type { Frame, Stroke, ToonDocument } from '../format/types';
import {
  DEFAULT_BRUSH_COLOR,
  DEFAULT_FILL_COLOR,
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
import type { Box } from '../model/geom';
import { applyMatrix } from '../model/geom';
import { editCells, makeHost } from '../plugins/host';
import { isHelpTool, plugins } from '../plugins';
import type { PluginBrush } from '../plugins/contract';
import { toonopRules } from '../tools/brush';
import type { StrokeRules } from '../tools/profiles';
import { compareVersions, readCatalog, type CatalogEntry } from '../plugins/catalog';
import { installFromCatalog, installFromFile, loadInstalled, updateInstalled } from '../plugins/install';
import { listInstalled, removeInstalled } from '../plugins/store';
import { brushOfType, type BrushType } from '../plugins/brush-types';
import type { PluginHost, PluginStroke } from '../plugins/contract';

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
  resolveToolSelection,
  toolAfterColorChange,
  toolAfterHelp,
  type UxProfile,
} from './ux-profile';
import {
  currentName,
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
  normalizePanels,
  toolSpec,
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
  copyBrushes,
  FALLBACK_BRUSH,
  brushUsesSmoothing,
  defaultBrushOf,
  DEFAULT_SETTINGS,
  loadUiConfig,
  presetBrushType,
  presetDefaultBrush,
  presetExists,
  presetPanels,
  presetUx,
  saveUiConfig,
  PANEL_HEIGHT_MAX,
  PANEL_HEIGHT_MIN,
  SIDE_WIDTH_MAX,
  SIDE_WIDTH_MIN,
  type BrushToolId,
  type EditorSettings,
  type SideId,
  type BrushRecord,
} from './presets';
import { t } from '../i18n';

/**
 * A tool is whatever the register has (plugins/registry.ts), so this is an id
 * rather than a closed union: the editor asks the register for a tool's
 * traits instead of reading them off its name.
 */
export type Tool = string;

/**
 * Steps kept inside one transform session. A drag writes one per pointermove,
 * so this is a ring, not a full history — enough to walk back out of a bad
 * rotation, bounded so a long drag cannot grow without end.
 */
const TRANSFORM_HISTORY_LIMIT = 100;
/** Block edits kept for undo; each holds a copy of the cells it wrote. */
const EDIT_HISTORY_LIMIT = 100;

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
   * Which brush of the tool in hand draws: the everyday one, the oldschool
   * pen that commits a wobbly closed contour, or the multator line. Session
   * state, like the tool — a preset only says what it opens with.
   */
  brushType = $state<BrushType>('normal');
  /**
   * Whether the mega-eraser has already warned this session. Session state,
   * not a setting: the reference warns again in the next tab.
   */
  megaEraserWarned = $state(false);
  /** The open lasso/distort session; null when nothing is selected. */
  transform = $state<TransformState | null>(null);
  /**
   * A line the canvas shows in its live hint: why a tool did nothing. A fresh
   * object each time, so the same reason twice is said twice.
   */
  canvasHint = $state<{ text: string } | null>(null);
  /**
   * A canvas gesture holds the pointer (stroke, eraser, handle, tool drag).
   * The editor keys wait meanwhile: a frame deleted or undone under the hand
   * left the gesture writing into a cell that was no longer there.
   */
  gestureHeld = false;
  /** Reference checkbox: the stroke width follows the scale. Sticky across selections. */
  transformWidthWithScale = $state(false);
  /** The live gesture of a tool that brought its own (plugins): the cells as they were on press. */
  private pluginGesture: { snapshots: CellSnapshot[] } | null = null;
  /**
   * Bumped whenever the register changed. The register is plain data outside
   * the runes (it is read by pure tests), so this is what tells the rail and
   * the settings list that there is something new to draw.
   */
  pluginsVersion = $state(0);
  /**
   * An update is downloading: the editor is locked behind it. Up only while
   * something is actually coming down the wire — a check that finds nothing
   * new is not something anyone should notice.
   */
  updating = $state(false);
  /** The window a tool opened over the canvas; it goes when the tool is left. */
  pluginWindow = $state<{ title: string; el: HTMLElement } | null>(null);
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
  /**
   * The document, held as a value. `$state` would proxy it all the way down —
   * a signal per layer, per frame, per stroke and per coordinate — and the
   * render path reads those coordinates thousands of times a frame, at 35× the
   * cost of a plain array. So the holder is raw, and every write goes through
   * `#write`, which replaces it: that replacement is what the canvas, the
   * thumbnails and the autosave hear.
   */
  doc = $state.raw(createDocument());
  activeFrame = $state(0);
  /** Layer the next stroke goes into; UI state, not part of the document. */
  activeLayer = $state(0);
  playing = $state(false);
  /** Frame shown while playback is running. */
  playbackFrame = $state(0);
  /**
   * The canvas a brush measures on when it named none of its own — the
   * preset's. Nothing else hangs on it: how the canvas is rasterised and what
   * Alt+S saves belong to the UX profile, and a width belongs to the brush.
   */
  defaultBrush = $state<string>(presetDefaultBrush(DEFAULT_PRESET));
  /**
   * Width, smoothing and minimum per brush: picking a tool puts its own
   * numbers back in the sliders. A record appears the first time a slider
   * moves for that tool; until then the brush's own defaults stand.
   */
  byTool = $state<Record<BrushToolId, BrushRecord>>({});
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
  /** The page's error log (error-log.ts), shared by every editor on it. */
  readonly errorLog: string[] = sessionErrors.lines;
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
  edits = $state.raw<CellSnapshot[][]>([]);
  /** Strokes taken off by undo, newest last — what redo puts back. */
  undone = $state.raw<{ cell: Frame; stroke: Stroke }[]>([]);
  /** Clipboard for frame copy/paste: every layer's cell, deep-copied on copy. */
  copiedColumn = $state.raw<ResolvedColumn | null>(null);
  /** Timeline cells the user has selected; a plain click leaves one. */
  selection = $state<CellSelection>({ frames: [0], layers: [0] });
  /** Clipboard for the timeline block copy/paste, deep-copied on copy. */
  copiedCells = $state.raw<CellBuffer | null>(null);
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
  /** The saved preset is not in the register yet; its plugin may still arrive. */
  private presetPending = false;
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
  get availableTools(): Tool[] {
    return visibleTools(this.panels);
  }

  constructor() {
    const saved = loadUiConfig();
    if (saved) {
      this.preset = saved.preset;
      this.presetPending = !presetExists(saved.preset);
      this.panels = saved.panels;
      this.floatPos = saved.floatPos;
      this.defaultBrush = saved.drawing.defaultBrush;
      this.byTool = copyBrushes(saved.drawing.byTool);
      this.pickSource = saved.drawing.pickSource;
      this.panelHeight = saved.drawing.panelHeight;
      this.sides = saved.drawing.sides;
      this.panelCollapsed = saved.drawing.panelCollapsed;
      this.settings = saved.settings;
    }
    this.workspaces = loadWorkspaces();
    // A plugin that threw is off already; what is left is to drop it from the
    // hand and the rail, which the register knows nothing about. Out of the
    // current task: the throw may come from inside a derived — the brush
    // preview asks the tool for its descriptor — and runes state MUST NOT be
    // written while one is being computed.
    plugins.onBreak = () => queueMicrotask(() => this.refreshPlugins());
    if (typeof window !== 'undefined') {
      sessionErrors.watch(window, console);
    }
    this.paletteExpanded = this.ux.quickPalette === null;
    this.doc = createDocument({ frameRate: this.ux.defaultFps });
    // The reference names every layer it creates, the first one included.
    // Without a name here the row falls back to its position, and the moment
    // a second layer slid in under it both rows would read «Слой 2».
    this.#write((doc) => renameLayer(doc, 0, t('layer.default_name', { n: 1 })));
  }

  /** Behavior profile of the active preset (palette, eraser rule, onion side, frames, playback). */
  get ux(): UxProfile {
    return presetUx(this.preset);
  }

  /**
   * The brush that lays the stroke down: the tool in hand, or the twin of
   * the picked type — the old pen, the multator line. The tool itself never
   * changes — the rail,
   * the width record and what a preset offers all stay with it.
   */
  get brushTool(): Tool {
    return brushOfType(this.tool, this.brushType);
  }

  /** The brush record as a plugin sees it: what `rules()` and `descriptor()` get. */
  get pluginBrush(): PluginBrush {
    const brush = this.brush;
    return {
      width: brush.width,
      color: this.brushColor,
      fill: this.fillColor,
      smooth: brush.smooth,
      minDistance: brush.minDistance,
    };
  }

  /**
   * The rules the width is measured by: the tool in hand when it named its
   * own, the preset's brush otherwise. The tool in hand and not the twin a
   * type resolves to — switching a type MUST NOT move the slider.
   */
  get widthRules(): StrokeRules | undefined {
    return plugins.tool(this.tool)?.stroke?.rules?.(this.pluginBrush)
      ?? plugins.tool(this.defaultBrush)?.stroke?.rules?.(this.pluginBrush);
  }

  /** The rules the gesture actually runs under: those of the brush that draws. */
  get brushRules(): StrokeRules {
    return plugins.tool(this.brushTool)?.stroke?.rules?.(this.pluginBrush)
      ?? plugins.tool(this.defaultBrush)?.stroke?.rules?.(this.pluginBrush)
      // Nothing registered at all: the editor still draws with its own brush.
      ?? toonopRules(this.pluginBrush);
  }

  /** What a width may be on the canvas in hand — the brush says, else the profile. */
  get brushRange(): { min: number; max: number } {
    return this.widthRules?.range ?? { min: MIN_BRUSH_SIZE_LOGICAL, max: this.ux.brushSizeMax };
  }

  /**
   * Brush record of the tool in hand — what the sliders read. A brush met for
   * the first time (a plugin's, the old pen's) reads its own defaults; the
   * record itself is written only when a slider moves, because a getter runs
   * inside `$derived` and MUST NOT touch state there.
   */
  get brush(): BrushRecord {
    const brush = this.byTool[brushToolOf(this.tool)] ?? defaultBrushOf(this.brushSource);
    // A width grown under a wider preset (Multator's 640) is read at this
    // preset's ceiling (Toonop's 500): the field, the track and the stroke
    // agree, and the record keeps the number for the way back.
    const max = this.ux.brushSizeMax;
    return brush.width > max ? { ...brush, width: max } : brush;
  }

  /** Whose defaults a brush met for the first time reads: its own, else the preset's. */
  private get brushSource(): string {
    return plugins.probeRules(this.tool) ? this.tool : this.defaultBrush;
  }

  /** One slider move: the record of the tool in hand, written whole. */
  private editBrush(patch: Partial<BrushRecord>): void {
    // An emptied number field reads NaN, and Math.round/min/max pass it on:
    // the record would be saved as `null`. Such a value changes nothing.
    if (Object.values(patch).some((v) => typeof v === 'number' && !Number.isFinite(v))) return;
    this.byTool = { ...this.byTool, [brushToolOf(this.tool)]: { ...this.brush, ...patch } };
    this.persistUiConfig();
  }

  /**
   * Whether the smoothing sliders reach the brush that draws. They belong to
   * the Tonio commit, so on a Multator line, the old pen or the pixel they
   * would be two numbers that change nothing — and the panel leaves them out.
   */
  get brushSmooths(): boolean {
    return brushUsesSmoothing(this.brushTool, this.defaultBrush);
  }

  get brushSmooth(): number {
    return this.brush.smooth;
  }

  get brushMinDistance(): number {
    return this.brush.minDistance;
  }

  get brushSizeLogical(): number {
    return this.brush.width;
  }

  /**
   * Where the thickness slider stops: the narrower of what the preset offers
   * and what the brush's own canvas holds — a Multator brush does not grow to
   * 500 because a Tonio preset is open around it.
   */
  get brushSizeMax(): number {
    return Math.min(this.ux.brushSizeMax, this.brushRange.max);
  }

  set brushSizeLogical(value: number) {
    const range = this.brushRange;
    this.editBrush({ width: Math.min(range.max, Math.max(range.min, Math.round(value))) });
  }

  setBrushSmooth(value: number): void {
    this.editBrush({ smooth: Math.min(100, Math.max(1, Math.round(value))) });
  }

  setBrushMinDistance(value: number): void {
    this.editBrush({ minDistance: Math.min(30, Math.max(0, Math.round(value))) });
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
    this.defaultBrush = presetDefaultBrush(id);
    // Multator opens with its own line in hand; the other presets with the
    // everyday brush. A type picked afterwards stays until the next preset.
    this.brushType = presetBrushType(id);
    this.paletteExpanded = this.ux.quickPalette === null;
    if (this.touched) {
      // A narrower profile range must not leave the document out of bounds.
      const fps = clampPlayerFps(this.doc.frame_rate, this.ux.fpsRange);
      this.#write((doc) => setFrameRate(doc, fps));
    } else {
      this.#write((doc) => setFrameRate(doc, this.ux.defaultFps));
    }
    this.persistUiConfig();
  }

  /**
   * Tool selection through the profile's rules: under Multator the pencil
   * with a white color is the eraser and the pipette needs the expanded
   * palette. Unavailable requests are ignored.
   */
  selectTool(
    tool: Tool,
    pipetteTarget: 'outline' | 'fill' = 'outline',
    available: readonly Tool[] = this.availableTools,
  ): void {
    const resolved = resolveToolSelection(
      tool,
      this.brushColor,
      this.ux,
      this.paletteExpanded,
      available,
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
    if (resolved !== this.tool) {
      // A tool that brought its own window takes it away with it, the way the
      // pipette source and the zoom window come and go with theirs.
      toolSpec(this.tool)?.deactivate?.(this.pluginHost());
      this.closePluginWindow();
    }
    this.tool = resolved;
    toolSpec(resolved)?.activate?.(this.pluginHost());
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
      workspace?.name ?? currentName(),
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
   * The one way into the document. The holder is a value, so a change to what
   * is inside it is heard by nobody until the holder itself is replaced —
   * which is what happens here, once, for every write the editor makes. The
   * wrapper is five fields; the layers array under it is the same one.
   */
  #write<T>(change: (doc: ToonDocument) => T): T {
    const result = change(this.doc);
    this.doc = { ...this.doc };
    return result;
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
      this.#write((doc) => setLayerHidden(doc, this.activeLayer, false));
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
    this.activeLayer = this.#write((doc) => addLayer(doc, at));
    this.layerColors.splice(at, 0, this.layerCounter % LAYER_TAGS);
    this.layerCounter++;
    this.#write((doc) => renameLayer(doc, at, t('layer.default_name', { n: this.layerCounter })));
    this.touched = true;
  }

  /** What the panel calls a layer: its stored name, or its position. */
  layerLabel(index: number): string {
    return this.doc.layers[index]?.name ?? t('layer.default_name', { n: index + 1 });
  }

  /** Names a layer (double click in the panel); a blank name goes back to the position. */
  renameActiveLayer(index: number, name: string): void {
    if (this.playing || !this.doc.layers[index]) {
      return;
    }
    this.#write((doc) => renameLayer(doc, index, name));
    this.touched = true;
  }

  removeActiveLayer(): void {
    if (this.playing || this.doc.layers.length <= 1) {
      return;
    }
    if (!this.confirmed(t('layer.delete_confirm', { name: this.layerLabel(this.activeLayer) }))) {
      return;
    }
    const removed = this.activeLayer;
    this.#write((doc) => removeLayer(doc, removed));
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
    this.#write((doc) => moveLayer(doc, from, to));
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
    this.#write((doc) => setLayerHidden(doc, index, !layer.hidden));
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
    for (const [id, brush] of Object.entries(this.byTool)) {
      widths[id] = brush.width;
      smooth[id] = brush.smooth;
      minDistance[id] = brush.minDistance;
    }
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
    // Whatever brushes the draft wrote down, plus the ones already in hand:
    // a brush met for the first time takes its own defaults.
    const byTool = { ...this.byTool };
    for (const id of new Set([...BRUSH_TOOLS, ...Object.keys(byTool), ...Object.keys(saved.widths ?? {})])) {
      const was = byTool[id] ?? FALLBACK_BRUSH;
      byTool[id] = {
        width: saved.widths?.[id] ?? was.width,
        smooth: saved.smooth?.[id] ?? was.smooth,
        minDistance: saved.minDistance?.[id] ?? was.minDistance,
      };
    }
    this.byTool = byTool;
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
    this.activeFrame = this.#write((doc) => addFrame(doc, this.activeFrame));
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
    this.activeFrame = this.#write((doc) => insertFrameBefore(doc, this.activeFrame));
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
    if (!this.confirmed(t('frame.delete_confirm', { n: this.activeFrame + 1 }))) {
      return;
    }
    const left = this.activeFrame;
    this.#write((doc) => removeFrame(doc, this.activeFrame));
    this.activeFrame = activeFrameAfterRemove(this.activeFrame, frameCount(this.doc), this.ux.afterRemove);
    this.visitedFrames = pushVisited(this.visitedFrames, left, this.activeFrame);
    this.collapseSelection();
    this.touched = true;
  }

  setFps(value: number): void {
    this.#write((doc) => setFrameRate(doc, clampPlayerFps(value, this.ux.fpsRange)));
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
      this.#write((doc) => replaceColumn(doc, this.activeFrame, this.copiedColumn!));
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
      if (!this.confirmed(t('frame.replace_confirm'))) {
        return;
      }
      if (
        (frames > 1 || layers > 1)
        && !this.confirmed(t('frame.affects_confirm', { frames, layers }))
      ) {
        return;
      }
    }
    const snapshots = this.snapshotCells(target);
    try {
      this.#write((doc) => write(doc, target, buffer));
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
    this.edits = [...this.edits, snapshots].slice(-EDIT_HISTORY_LIMIT);
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
      this.edits = this.edits.slice(0, -1);
      for (const snapshot of edit) {
        this.#write((doc) => replaceStrokes(doc, snapshot.layer, snapshot.frame, snapshot.strokes));
      }
      this.undone = [];
      this.touched = true;
      return;
    }
    const cell = this.activeCell!;
    const stroke = cell.strokes[cell.strokes.length - 1];
    if (!this.#write((doc) => removeLastStroke(doc, this.activeLayer, this.activeFrame))) {
      return;
    }
    // Unbounded, like the reference's own buffer: a stroke off the stack is
    // still the one the document held a moment ago, not a second copy of it.
    this.undone = [...this.undone, { cell, stroke }];
    this.touched = true;
  }

  /** Redo: puts the last undone stroke back where it came from. */
  redo(): void {
    if (!this.canRedo) {
      return;
    }
    const { stroke } = this.undone[this.undone.length - 1];
    this.undone = this.undone.slice(0, -1);
    // The tool is still interned, so this resolves to the same tool_id.
    const tool = this.doc.tools[stroke.tool_id];
    this.#write((doc) => addStroke(doc, this.activeLayer, this.activeFrame, {
      points: stroke.points,
      tool,
    }));
    this.touched = true;
  }

  /**
   * Appends a finished stroke to the active frame. The one place strokes
   * enter the document, so it is also the one place a fresh stroke retires
   * the redo stack.
   */
  commitStroke(layerIndex: number, stroke: ResolvedStroke): void {
    this.#write((doc) => addStroke(doc, layerIndex, this.activeFrame, stroke));
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
    // How a stroke is cut is declared by the tool that lays that primitive
    // down; the eraser knows only the contour, which no tool lays down.
    const after = eraseStrokes(before, gesture, radius, this.doc.tools, (tool) =>
      plugins.tools().find((entry) => entry.stroke?.kind === tool.kind)?.stroke?.cut);
    if (after.length === before.length
      && after.every((piece, i) => piece.points.length === before[i].points.length)) {
      return;
    }
    const snapshots = this.snapshotCells({ frames: [this.activeFrame], layers: [this.activeLayer] });
    this.#write((doc) => replaceStrokes(doc, this.activeLayer, this.activeFrame, after));
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
      this.#write((doc) => mirrorCell(doc, layer, this.activeFrame, axis));
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
      this.#write((doc) => map(doc, layer, this.activeFrame));
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
      if (!this.playing) {
        this.canvasHint = { text: t('canvas.nothing_to_transform') };
      }
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
   * A tool that brought its own gesture (plugins/contract.ts) starts here: the
   * cells it may rewrite are snapshotted once, and whatever it writes by the
   * way becomes one step of undo on release. The plugin never sees the
   * history — a plugin that could spoil it would.
   */
  beginPluginGesture(): boolean {
    const layers = this.visibleSelectedLayers;
    if (this.playing || layers.length === 0) {
      return false;
    }
    this.pluginGesture = { snapshots: this.snapshotCells({ frames: [this.activeFrame], layers }) };
    return true;
  }

  /** Pointer up: the whole gesture becomes one undo step. */
  endPluginGesture(): void {
    if (this.pluginGesture) {
      this.pushEdit(this.pluginGesture.snapshots);
      this.pluginGesture = null;
    }
  }

  /** The strokes a plugin may rewrite: the current frame on the visible selected layers. */
  pluginStrokes(): PluginStroke[] {
    return this.visibleSelectedLayers.flatMap((layer) =>
      this.doc.layers[layer].frames[this.activeFrame].strokes.map(
        (stroke) => ({ ...stroke, points: [...stroke.points] }),
      ));
  }

  /**
   * One write of the running gesture; the editor clamps what comes back. Done
   * outside a gesture — a button in a plugin's own window — it is its own
   * gesture, so that edit is one step of undo as well.
   */
  editPluginCells(fn: (strokes: PluginStroke[]) => void): void {
    const standalone = !this.pluginGesture;
    if (standalone && !this.beginPluginGesture()) {
      return;
    }
    const gesture = this.pluginGesture;
    if (!gesture) {
      return;
    }
    const cells = gesture.snapshots.map(({ layer, frame }) => this.doc.layers[layer].frames[frame]);
    const next = editCells(cells, fn);
    gesture.snapshots.forEach(({ layer, frame }, i) => {
      // A fresh cell object, not a rewrite in place: that identity change is
      // what tells the canvas its buffers are stale.
      this.#write((doc) => replaceStrokes(doc, layer, frame, next[i]));
    });
    this.touched = true;
    if (standalone) {
      this.endPluginGesture();
    }
  }

  /**
   * The start of the plugins: what is installed comes up from the cache first,
   * so drawing never waits on the network, and only then does the catalog get
   * asked whether any of it has a newer version.
   */
  async startPlugins(): Promise<void> {
    await loadInstalled(plugins);
    this.refreshPlugins();
    const address = this.settings.pluginCatalog;
    if (!address.trim()) {
      return;
    }
    const catalog = await readCatalog(address);
    if (catalog.error) {
      console.warn(catalog.error);
      return;
    }
    // Lock only around the download itself: a check that finds nothing new
    // must be invisible.
    if (!(await this.hasUpdates(catalog.plugins))) {
      return;
    }
    this.updating = true;
    try {
      await updateInstalled(catalog.plugins, plugins);
    } finally {
      this.updating = false;
      this.refreshPlugins();
    }
  }

  /** Whether anything installed has a newer version in the catalog. */
  private async hasUpdates(catalog: readonly CatalogEntry[]): Promise<boolean> {
    const installed = await listInstalled();
    return installed.some((plugin) => plugin.source === 'catalog'
      && catalog.some((entry) => entry.id === plugin.id && compareVersions(entry.version, plugin.version) > 0));
  }

  /**
   * The register changed. The arrangement is read again — a tool that arrived
   * takes the place its preset has for it, and one that is gone leaves without
   * taking the rest of the layout with it — and a tool that is no longer there
   * cannot stay in hand.
   */
  refreshPlugins(): void {
    // A preset whose plugin was not there when the config was read: the
    // choice was kept, so the moment the plugin arrives the editor opens the
    // way it was left.
    if (this.presetPending && presetExists(this.preset)) {
      this.presetPending = false;
      this.applyPreset(this.preset);
    }
    this.panels = normalizePanels(this.panels);
    this.pluginsVersion++;
    if (!plugins.tool(this.tool)) {
      this.selectTool('pencil');
    }
  }

  /** Installs one plugin of the catalog; the reason comes back when it did not. */
  async installPlugin(entry: CatalogEntry): Promise<string | null> {
    const failed = await installFromCatalog(entry, plugins);
    this.refreshPlugins();
    return failed;
  }

  /** Installs a bundle picked from disk. */
  async installPluginFile(code: string): Promise<string | null> {
    const failed = await installFromFile(code, plugins);
    this.refreshPlugins();
    return failed;
  }

  /** Takes a plugin off: out of storage, off the panel, and out of the hand. */
  async removePlugin(id: string): Promise<void> {
    plugins.remove(id);
    await removeInstalled(id);
    this.refreshPlugins();
  }

  /** Switches a plugin that broke back on — the button beside it in the list. */
  enablePlugin(id: string): void {
    plugins.enable(id);
    this.refreshPlugins();
  }

  /**
   * What a plugin is handed — never this object, which carries the runes state.
   * The words in it are the ones the tool's own plugin shipped, so the host is
   * built for whatever is in hand at the moment it is asked for.
   */
  pluginHost(plugin = toolSpec(this.tool)?.plugin ?? ''): PluginHost {
    return makeHost(this, plugin);
  }

  /** The node a plugin draws its own controls into, inside a window of the editor. */
  openPluginWindow(title: string): HTMLElement {
    const el = document.createElement('div');
    this.pluginWindow = { title, el };
    return el;
  }

  closePluginWindow(): void {
    this.pluginWindow = null;
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
      this.canvasHint = { text: t('canvas.transform_locked') };
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
        defaultBrush: this.defaultBrush,
        byTool: copyBrushes(this.byTool),
        pickSource: this.pickSource,
        panelHeight: this.panelHeight,
        sides: $state.snapshot(this.sides),
        panelCollapsed: this.panelCollapsed,
      },
      settings: this.settings,
    });
  }
}
