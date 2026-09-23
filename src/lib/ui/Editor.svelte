<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import { plugins } from '../plugins';
  import { EditorState } from './editor-state.svelte';
  import CanvasView from './CanvasView.svelte';
  import BrushPanel from './BrushPanel.svelte';
  import BrushSizes from './BrushSizes.svelte';
  import ColorPanel from './ColorPanel.svelte';
  import PaletteBox from './PaletteBox.svelte';
  import ToolKey from './ToolKey.svelte';
  import FloatWindow from './FloatWindow.svelte';
  import PanelArranger from './PanelArranger.svelte';
  import TransformMenu from './TransformMenu.svelte';
  import ScaleMenu from './ScaleMenu.svelte';
  import ExportSheet from './ExportSheet.svelte';
  import AudioPanel from './AudioPanel.svelte';
  import Timeline from './Timeline.svelte';
  import PlayControls from './PlayControls.svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import PluginsSheet from './PluginsSheet.svelte';
  import Icon from './Icon.svelte';
  import './tokens.css';
  import './controls.css';
  import { decodeLegacyJson, decodeToon } from '../format/toon-decode';
  import { loadDocument } from '../format/validate';
  import { isEmptyDocument } from '../model/operations';
  import { draftSizeClass, formatFileSize } from './file-size';
  import { saveFile } from './save-file';
  import { fitThumb } from './thumb-size';
  import { zoomDelta } from './viewport';
  import { extendTarget, wrapIndex } from './frame-selection';
  import { keyOwner, latinKey } from './key-owner';
  import { draftEntries } from '../draft/restore';
  import {
    deleteAllDrafts,
    deleteDraft,
    duplicateDraft,
    exportDrafts,
    listDrafts,
    newDraftId,
    saveDraft,
    setDraftAudio,
    setDraftCredits,
    setDraftScreenshot,
  } from '../draft/store';
  import { renderScreenshot } from '../export/preview-webp';
  import type { AudioTrackData } from '../audio/state.svelte';
  import FrameThumb from './FrameThumb.svelte';
  import {
    PANEL_HEIGHT_AUDIO,
    PANEL_HEIGHT_MIN,
    PANEL_ROW_STEP,
    SIDE_WIDTH_MAX,
    SIDE_WIDTH_MIN,
  } from './presets';
  import { panelItem as panelItemSpec, toolOfItem } from './panels';
  import type { SideId } from './presets';
  import type { DraftEntry } from '../draft/restore';
  import type { ToonDocument } from '../format/types';
  import { t } from '../i18n';

  // Optional publish hook. When a host app provides it, a Publish button appears
  // and hands the host a plain snapshot of the current document; the editor
  // itself stays unaware of what publishing means (no network, no platform
  // coupling).
  // The soundtrack travels beside the document, not inside it: the toon format
  // holds drawings, and the platform stores the file on its own endpoint.
  // `stageNote` is the host's own word over the canvas — the site's first-run
  // hint. The stage is the only box that knows where the canvas is, so the
  // note is placed against it rather than against the whole editor.
  let {
    onPublish,
    stageNote,
  }: {
    onPublish?: (doc: ToonDocument, audio?: AudioTrackData | null) => void;
    stageNote?: Snippet;
  } = $props();

  const editor = new EditorState();
  // The session being autosaved. Minted when the editor opens and kept for as
  // long as this sheet lives, so a visit overwrites its own record instead of
  // piling up a new draft per stroke (reference `autosave_worker.js:14-22`); a
  // draft opened from the list continues under its own id, and opening a file
  // starts a fresh one. Nothing is written until something is drawn.
  let draftId = newDraftId();

  // Root element, so F can request fullscreen on the whole editor.
  let editorEl: HTMLDivElement;
  let audioOpen = $state(false);
  let audioKey = $state<HTMLButtonElement | undefined>();
  // Components the keyboard drives: Space is play/stop, Alt+S the export.
  let playControls = $state<PlayControls | undefined>();
  let exportButton = $state<ExportSheet | undefined>();

  // The two sheets the editor draws itself. `showModal()` is what makes them
  // modal in fact and not only in the accessibility tree; `onclose` puts the
  // flag back, so Esc and the close buttons end at the same place.
  let draftsDialog = $state<HTMLDialogElement | undefined>();
  let manualDialog = $state<HTMLDialogElement | undefined>();
  $effect(() => {
    draftsDialog?.showModal();
  });
  $effect(() => {
    manualDialog?.showModal();
  });
  // The mega-eraser warning: a dialog, not alert(), so it can carry
  // «Больше не показывать» — a reload used to bring the alert back for good.
  let megaWarnOpen = $state(false);
  let megaWarnDialog = $state<HTMLDialogElement | undefined>();
  $effect(() => {
    megaWarnDialog?.showModal();
  });

  /** Mirrors `document.fullscreenElement`, so the button can show it is on. */
  let isFullscreen = $state(false);

  function toggleFullscreen(): void {
    if (!document.fullscreenEnabled) {
      return;
    }
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : editorEl.requestFullscreen();
    void request.catch(() => {});
  }

  /**
   * A sheet over a full-screen editor is a dialog with nowhere to go, so the
   * reference drops out of the mode first (`bundle:7551-7560, 7104-7125`).
   */
  function leaveFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }

  /**
   * Alt+L, the reference's own debug hatch (`bundle:11407-11409`): whatever
   * the session logged as an error, as a file. Nothing leaves the machine.
   */
  function downloadErrorLog(): void {
    const lines = editor.errorLog.length > 0 ? editor.errorLog : [new Date().toISOString()];
    saveFile(new Blob([lines.join('\n')], { type: 'text/plain' }), 'toonop-errors.txt');
  }

  // --- Bottom panel divider ------------------------------------------------
  // Alt+E and F are tools only while their keys are on the panels: put the
  // feather back in a preset that started without it and F picks it up, take
  // it away and F is fullscreen again. The quick palette (a preset's own
  // behaviour) still decides whether M opens the picker (Multator) or merges
  // the buffer (Toonio/Toonop).
  const hasMegaEraser = $derived(editor.availableTools.includes('mega-eraser'));
  const hasFeather = $derived(editor.availableTools.includes('feather'));
  const quickPalette = $derived(editor.ux.quickPalette !== null);
  /** The pipette's source pair is on the panel always, live only under the pipette. */
  const pipetteUp = $derived(editor.tool === 'pipette');
  /** Toonio keeps a project file behind Alt+S; the others export instead. */
  const hasProjectFile = $derived(editor.ux.projectFile);

  // The studio bar is resizable from its top edge, and the timeline is the row
  // that grows with it — dragging down gives the grid more layers and frames.
  let viewportHeight = $state(0);
  let viewportWidth = $state(0);
  /**
   * The floor grows with a soundtrack: the strip and the wave lane are part of
   * the timeline, so a panel sitting at its minimum has to make room for them
   * rather than push the layer rows out of view.
   */
  /** Each bottom row's content box — padding out, so a row's bleed is not a wrap. */
  let rowBoxes = $state<(DOMRectReadOnly | undefined)[]>([]);
  /** One key tall: what the floor's arithmetic expects of a row of keys. */
  const KEY_ROW = 44;
  /**
   * The root text size over the 16px the floor's numbers were measured at. The
   * keys and the strip head are in rem, so at 200 % text a floor in fixed px
   * left the layer row under the panel's edge. Read again when the window
   * resizes — a browser zoom is a resize too.
   */
  const textScale = $derived.by(() => {
    void viewportWidth;
    return parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
  });
  /**
   * What wrapped key rows take beyond one key each. Between a phone and a wide
   * desktop the transport does not fit one line and wraps; the floor has to
   * hear about it, or the second line comes out of the strip and the layer
   * rows go under the panel's edge. The strip's own row grows with the panel.
   */
  const wrapExtra = $derived(
    editor.panels.rows.reduce(
      (sum, row, i) => (row.includes('timeline') ? sum : sum + Math.max(0, (rowBoxes[i]?.height ?? 0) - KEY_ROW * textScale)),
      0,
    ),
  );
  const panelFloor = $derived(
    Math.round(
      (PANEL_HEIGHT_MIN
        + (editor.audio.hasTrack ? PANEL_HEIGHT_AUDIO : 0)
        // The floor is written for a strip and one row; every row beyond that
        // needs its own height, or it is cut off at the panel's edge.
        + Math.max(0, editor.panels.rows.length - 2) * PANEL_ROW_STEP) * textScale
        + wrapExtra,
    ),
  );
  /** The stored panel height, never more than three quarters of the viewport. */
  const panelHeight = $derived(
    Math.max(panelFloor, Math.min(editor.panelHeight, Math.round((viewportHeight || 800) * 0.75))),
  );
  /** Keyboard step for the divider, in px (WCAG 2.2 AA 2.5.7 — no drag required). */
  const PANEL_STEP = 22;
  /**
   * The drag in progress on any of the three dividers. `sign` is which way the
   * pointer has to travel for the panel to grow: the bottom bar and the column
   * on the right grow as the pointer comes back towards the canvas.
   */
  let resize = $state<
    | {
        pointerId: number;
        from: number;
        size: number;
        sign: number;
        axis: 'x' | 'y';
        side: SideId | 'panel' | null;
        apply: (px: number) => void;
      }
    | null
  >(null);

  function startResize(
    e: PointerEvent,
    axis: 'x' | 'y',
    sign: number,
    size: number,
    apply: (px: number) => void,
    side: SideId | 'panel' | null = null,
  ): void {
    if (!e.isPrimary) return;
    resize = { pointerId: e.pointerId, from: axis === 'y' ? e.clientY : e.clientX, size, sign, axis, side, apply };
  }

  function onDividerMove(e: PointerEvent): void {
    if (!resize || e.pointerId !== resize.pointerId) return;
    const now = resize.axis === 'y' ? e.clientY : e.clientX;
    resize.apply(resize.size + (now - resize.from) * resize.sign);
  }

  function onDividerUp(e: PointerEvent): void {
    if (resize && e.pointerId === resize.pointerId) resize = null;
  }

  function onDividerKey(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        editor.setPanelHeight(panelHeight + PANEL_STEP);
        break;
      case 'ArrowDown':
        e.preventDefault();
        editor.setPanelHeight(panelHeight - PANEL_STEP);
        break;
    }
  }

  // --- Side columns --------------------------------------------------------
  // Both side columns resize from their inner edge and fold away to a strip
  // with an arrow on it. Which edge that is depends on the alternative layout,
  // where the two columns swap places.
  /** What each column measures now, so an undragged one starts from its own width. */
  const sidePx = $state({ left: 0, right: 0 });
  /** Keyboard step for a column divider, in px (WCAG 2.2 AA 2.5.7). */
  const SIDE_STEP = 16;
  /** Whether the column is the one on the screen's left, after the alt swap. */
  const atLeft = (id: SideId): boolean => (id === 'left') !== editor.settings.altLayout;
  /**
   * Folded away — but never on a phone, where the columns are rows across the
   * screen and the strip they would fold to has nowhere to sit. A fold made on
   * a desktop must not leave the tools unreachable there.
   */
  const folded = (id: SideId): boolean => editor.sides[id].collapsed && viewportWidth > 640;
  /** The bottom bar, folded away by the same rule. */
  const panelFolded = $derived(editor.panelCollapsed && viewportWidth > 640);
  const sideWidth = (id: SideId): number => editor.sides[id].width ?? sidePx[id];
  /** A folded column is sized by its strip rule, not by the width it remembers. */
  const sideStyle = (id: SideId): string | undefined =>
    !folded(id) && editor.sides[id].width ? `width: ${editor.sides[id].width}px` : undefined;
  /** Collapse points away from the canvas, expand points back towards it. */
  const foldIcon = (id: SideId, collapsed: boolean): 'chevron-left' | 'chevron-right' =>
    atLeft(id) === collapsed ? 'chevron-right' : 'chevron-left';

  function onSideDown(e: PointerEvent, id: SideId): void {
    startResize(e, 'x', atLeft(id) ? 1 : -1, sideWidth(id), (px) => editor.setSideWidth(id, px), id);
  }

  function onSideKey(e: KeyboardEvent, id: SideId): void {
    const step = e.key === 'ArrowRight' ? SIDE_STEP : e.key === 'ArrowLeft' ? -SIDE_STEP : 0;
    if (!step) return;
    e.preventDefault();
    editor.setSideWidth(id, sideWidth(id) + step * (atLeft(id) ? 1 : -1));
  }

  /** Arrow keys: Shift grows the timeline selection, a bare arrow moves the active cell. */
  function moveOrExtend(shift: boolean, dFrame: number, dLayer: number): void {
    const active = { frame: editor.activeFrame, layer: editor.activeLayer };
    if (shift) {
      // Each press moves the block's far edge; the active cell is the anchor.
      const to = extendTarget(editor.selection, active, dFrame, dLayer, editor.cellBounds);
      editor.selectCell(to.frame, to.layer, 'range');
      return;
    }
    editor.selectFrame(wrapIndex(active.frame + dFrame, lastFrame + 1));
    editor.selectLayer(wrapIndex(active.layer + dLayer, editor.doc.layers.length));
  }

  // Editor hotkeys, matching the reference editors: bare single keys, ignored
  // while typing in a form field or when a browser/OS modifier is held.
  function onKeydown(e: KeyboardEvent): void {
    // An update is downloading: the editor is not there to be typed at.
    if (editor.updating) {
      return;
    }
    // Read by place on a non-Latin layout: «и» is B (key-owner.ts).
    const key = latinKey(e);
    // Alt+E is the reference's mega-eraser; every other modifier is the
    // browser's or the OS's.
    if (e.altKey && (key === 'e' || key === 'E') && hasMegaEraser) {
      e.preventDefault();
      editor.selectTool('mega-eraser');
      return;
    }
    // Reference Ctrl+S / Alt+S / Alt+Enter. These fire from a form field too:
    // the browser would otherwise take Ctrl+S for "save page", and muting the
    // warnings is not a keystroke anyone types by accident.
    if ((e.ctrlKey || e.metaKey) && (key === 's' || key === 'S')) {
      e.preventDefault();
      saveNow(true);
      return;
    }
    if (e.altKey && (key === 's' || key === 'S')) {
      e.preventDefault();
      // Reference Alt+S in Toonio saves the project to a file; the other
      // presets have no project file, so there it stays the export.
      if (hasProjectFile) {
        saveProjectFile();
      } else {
        exportButton?.start();
      }
      return;
    }
    if (e.altKey && key === 'Enter') {
      e.preventDefault();
      editor.warnings = !editor.warnings;
      return;
    }
    // Reference Alt+L: the session's errors as a file, for a bug report.
    if (e.altKey && (key === 'l' || key === 'L')) {
      e.preventDefault();
      downloadErrorLog();
      return;
    }
    if (e.altKey) {
      return;
    }
    // The reference dispatches its hotkey table whatever modifier is held, so
    // Ctrl+Z, Ctrl+C, Ctrl+V and Ctrl+M land on the same handlers as the bare
    // keys; only A and F7 change meaning under Ctrl.
    // What the focused control, an open sheet or the letter-keys setting
    // keeps for itself never reaches the table (key-owner.ts).
    const owner = keyOwner({
      key,
      target: e.target instanceof HTMLElement ? e.target : null,
      defaultPrevented: e.defaultPrevented,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      modalOpen: document.querySelector('dialog:modal') !== null,
      letterKeys: editor.settings.letterKeys,
    });
    if (owner === 'control') {
      return;
    }
    // The hand takes the zoom and the arrows before frames and brush size do
    // — the reference's `helpTool.ArrowMove || PrevFrame` order.
    if (editor.tool === 'drag' && !editor.transform) {
      const step = e.shiftKey ? 30 : 10;
      let taken = true;
      switch (key) {
        case '+':
        case '=':
          editor.zoomBy(zoomDelta(editor.view.zoom, 1));
          break;
        case '-':
        case '_':
          editor.zoomBy(zoomDelta(editor.view.zoom, -1));
          break;
        case 'ArrowLeft':
          editor.panBy(step, 0);
          break;
        case 'ArrowRight':
          editor.panBy(-step, 0);
          break;
        case 'ArrowUp':
          editor.panBy(0, step);
          break;
        case 'ArrowDown':
          editor.panBy(0, -step);
          break;
        default:
          taken = false;
      }
      if (taken) {
        e.preventDefault();
        return;
      }
    }
    // An open transform owns the arrows, Q/W, +/- and Enter/Esc. Without one
    // those keys stay frame navigation and brush size, so this branch has to
    // come before the main switch.
    if (editor.transform) {
      let taken = true;
      switch (key) {
        // Reference: Space applies an unfinished transform instead of playing.
        case ' ':
        case 'Enter':
          editor.commitTransform();
          break;
        case 'Escape':
          editor.cancelTransform();
          break;
        case 'ArrowLeft':
          editor.nudgeTransform('move', -1, e.shiftKey, 'x');
          break;
        case 'ArrowRight':
          editor.nudgeTransform('move', 1, e.shiftKey, 'x');
          break;
        case 'ArrowUp':
          editor.nudgeTransform('move', -1, e.shiftKey, 'y');
          break;
        case 'ArrowDown':
          editor.nudgeTransform('move', 1, e.shiftKey, 'y');
          break;
        // Reference: Q and W turn the selection while it is live; outside a
        // transform Q is one of the two keys that pick the lasso up.
        case 'q':
        case 'Q':
          editor.nudgeTransform('rotate', -1, e.shiftKey);
          break;
        case 'w':
        case 'W':
          editor.nudgeTransform('rotate', 1, e.shiftKey);
          break;
        case '+':
        case '=':
          editor.nudgeTransform('scale', 1, e.shiftKey);
          break;
        case '-':
        case '_':
          editor.nudgeTransform('scale', -1, e.shiftKey);
          break;
        case 'h':
          editor.mirrorTransform('horizontal');
          break;
        case 'H':
          editor.mirrorTransform('vertical');
          break;
        // Z and Y walk the session's own steps. With none left they are
        // swallowed rather than falling through to the document's undo,
        // which would delete the strokes under the live frame.
        case 'z':
        case 'Z':
          editor.undoTransform();
          break;
        case 'y':
        case 'Y':
          editor.redoTransform();
          break;
        default:
          taken = false;
      }
      if (taken) {
        e.preventDefault();
        return;
      }
    }

    let handled = true;
    switch (key) {
      case '+':
      case '=':
        editor.increaseBrushSize();
        break;
      case '-':
      case '_':
        editor.decreaseBrushSize();
        break;
      case 'b':
      case 'B':
        editor.selectTool('pencil');
        break;
      case 'e':
      case 'E':
        editor.selectTool('eraser');
        break;
      case 'p':
      case 'P':
        editor.selectTool('pipette');
        break;
      // Reference transform tools: D or O is the hand, Q or S the lasso,
      // `~` the distort. Unavailable under a preset that has no such button —
      // selectTool drops what the profile does not offer.
      case 'd':
      case 'D':
      case 'o':
      case 'O':
        editor.selectTool('drag');
        break;
      case 'q':
      case 'Q':
      case 's':
      case 'S':
        editor.selectTool('lasso');
        break;
      case '~':
      case '`':
        editor.selectTool('distort');
        break;
      // Reference Mirror: with nothing selected H flips the frame on every
      // selected layer.
      case 'h':
        editor.mirrorSelectedLayers('horizontal');
        break;
      case 'H':
        editor.mirrorSelectedLayers('vertical');
        break;
      // The clipboard is the timeline selection (cells × layers) — the strip
      // carries layers in every preset now.
      case 'c':
      case 'C':
        editor.copySelection();
        break;
      case 'v':
      case 'V':
        editor.pasteSelection();
        break;
      case 'z':
      case 'Z':
        editor.undo();
        break;
      // Redo takes a bare key of its own, like every other shortcut here —
      // z/Z already both mean undo, so shift cannot carry it.
      case 'y':
      case 'Y':
        editor.redo();
        break;
      // Reference M merges the buffer into the selected cells. Under Multator
      // it keeps its own meaning — M is the only way to its full colour picker.
      case 'm':
      case 'M':
        quickPalette ? editor.togglePalette() : editor.mergeSelection();
        break;
      // The reference's F is the feather where the preset has one; ours is
      // fullscreen, which otherwise stays on the button.
      case 'f':
      case 'F':
        if (hasFeather) {
          editor.selectTool('feather');
        } else {
          toggleFullscreen();
        }
        break;
      // Reference HotAdd / HotRemove: A adds a frame, Shift+A a layer;
      // Delete removes the frame, Shift+Delete the layer.
      // Reference HotAdd: A (and F7) add a frame after the current one, the
      // same key with Ctrl inserts one in front of it.
      case 'a':
      case 'F7':
        if (e.ctrlKey || e.metaKey) {
          editor.addFrameBeforeActive();
        } else {
          editor.addFrameAfterActive();
        }
        break;
      case 'A':
        editor.addLayerAtActive(e.ctrlKey || e.metaKey);
        break;
      case 'Delete':
        if (e.shiftKey) {
          if (editor.doc.layers.length > 1 && (!editor.layerHasStrokes(editor.activeLayer) || askDelete(t('editor.layer_has_strokes')))) {
            editor.removeActiveLayer();
          }
        } else {
          editor.removeActiveFrame();
        }
        break;
      // Reference J / L and the arrows: frames sideways, layers up and down.
      case 'j':
      case 'J':
        editor.selectFrame(0);
        break;
      case 'l':
      case 'L':
        editor.selectFrame(lastFrame);
        break;
      // Shift extends the selection to the neighbor instead of walking the
      // active cell there — the keyboard equivalent of a Shift+click.
      case 'ArrowLeft':
        moveOrExtend(e.shiftKey, -1, 0);
        break;
      case 'ArrowRight':
        moveOrExtend(e.shiftKey, 1, 0);
        break;
      case 'ArrowUp':
        moveOrExtend(e.shiftKey, 0, 1);
        break;
      case 'ArrowDown':
        moveOrExtend(e.shiftKey, 0, -1);
        break;
      // Onion skin. The reference binds Tab; we do not — Tab is the way out
      // of the canvas for keyboard users (WCAG 2.1.2), so «калька» takes K.
      case 'k':
      case 'K':
        editor.toggleOnionSkin();
        break;
      // Reference: the X between the two swatches swaps outline and fill.
      case 'x':
      case 'X':
        editor.swapColors();
        break;
      // Reference Space: run and stop the preview. Shift starts at the
      // active frame instead of the start of the range.
      case ' ':
        playControls?.toggle({ fromActive: e.shiftKey });
        break;
      default: {
        // A plugin's key comes from its manifest, not from a case here: the
        // register already refused it if something above holds it.
        const added = plugins.toolByKey(key);
        if (added && !added.builtin) {
          editor.selectTool(added.id);
        } else {
          handled = false;
        }
      }
    }
    if (handled) {
      e.preventDefault();
    }
  }

  // Installed plugins come up from their cache, and only then does the
  // catalog get asked whether any of them has a newer version. Once, on
  // start: installing, removing and updating go through the plugins window.
  onMount(() => {
    void editor.startPlugins();
  });

  /** The lock over the editor while an update is downloading. */
  let updatingEl = $state<HTMLDialogElement | undefined>();
  $effect(() => {
    if (editor.updating) {
      updatingEl?.showModal();
    } else {
      updatingEl?.close();
    }
  });

  /** Where the body of a tool's own window is put; the tool owns what is in it. */
  let pluginSlot = $state<HTMLDivElement | undefined>();
  $effect(() => {
    const window = editor.pluginWindow;
    if (pluginSlot && window) {
      pluginSlot.replaceChildren(window.el);
    }
  });

  /** Something has changed since the last write. The autosave clock clears it. */
  let dirty = $state(false);

  // Track the change signals (fps, frame count, per-frame stroke count —
  // strokes are append-only). Skipping the untouched document also avoids
  // clobbering a draft before restore runs.
  $effect(() => {
    if (!editor.touched) {
      return;
    }
    // The document is one value and every write replaces it, so this is the
    // whole subscription. It used to be a walk over every cell of every
    // layer — frames × layers reads on each stroke.
    void editor.doc;
    dirty = true;
  });

  /** A write into working storage failed: stop trying and say so, once. */
  let saveFailed = $state(false);
  /** The clock came round during playback; the write waits for the stop. */
  let queued = false;
  /** Size of the record as last written — what the indicator reports. */
  let savedBytes = $state(0);

  /**
   * Writes the draft right now — the autosave clock, Ctrl+S and the sheet.
   * After a failure the clock stays off, but a save asked for by hand tries
   * again: the user may have freed the room in the drafts list since.
   */
  function saveNow(byHand = false): void {
    if (!editor.touched || (saveFailed && !byHand)) {
      return;
    }
    // The document is a value the editor holds whole, so it goes to storage as
    // it is: no snapshot to take, and no second pass over every stroke of the
    // drawing to size what the write is about to size anyway.
    const doc = editor.doc;
    queued = false;
    dirty = false;
    editor.lastSavedAt = Date.now();
    void saveDraft(draftId, doc, editor.sessionState()).then(({ ok, bytes }) => {
      if (ok) {
        savedBytes = bytes;
        saveFailed = false;
        writeScreenshot(doc);
        return;
      }
      saveFailed = true;
      dirty = true;
      alert(t('editor.save_failed_alert'));
    });
  }

  /** Called by the transport when a preview stops: the deferred write lands now. */
  export function saveQueued(): void {
    if (queued) {
      saveNow();
    }
  }

  /**
   * The card's thumbnail: rendered once per write, when the CPU is free.
   * Drawing it inline would cost a frame of the stroke that triggered it.
   */
  function writeScreenshot(doc: ToonDocument): void {
    // The record this write belongs to, captured now: by the time the browser
    // is idle a file may have been opened and `draftId` moved on.
    const id = draftId;
    const idle = globalThis.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 500));
    idle(() => {
      void renderScreenshot(doc)
        .then((blob) => setDraftScreenshot(id, blob))
        .catch((err) => console.warn('draft screenshot failed:', err));
    });
  }

  /**
   * Reference Alt+S in the Toonio preset: the project leaves as a file in our
   * own `.toonop` — the document exactly as the draft and the API hold it, no
   * wrapper. Sound and palette stay in the draft, as they do in a `.toon`.
   */
  function saveProjectFile(): void {
    if (editor.warnings && !confirm(t('editor.download_project_confirm'))) {
      return;
    }
    saveFile(new Blob([JSON.stringify(editor.doc)], { type: 'application/json' }), 'toonop.toonop');
  }

  // The track rides the draft but not the document: it is written on its own
  // whenever the file or its credits change, so an autosave never carries a
  // 10 MB blob and attaching a track never waits for the autosave clock.
  /**
   * The track already in the draft on disk. A restored track must not be
   * written straight back: it is megabytes of IndexedDB traffic for a record
   * that already holds them, it lands a second or two after the draft opens —
   * right when the preview is starting — and re-`put`ting a Blob that the
   * playing `<audio>` element is reading through an object URL is asking the
   * browser to swap the file under it.
   */
  let storedBlob: Blob | null = null;
  /** The light metadata as it stands on disk, so restoring it writes nothing. */
  let storedCredits = '';

  $effect(() => {
    const blob = editor.audio.blob;
    if (blob === storedBlob) {
      return;
    }
    const { name, author, sync } = untrack(() => editor.audio);
    storedBlob = blob;
    storedCredits = `${name}\u0000${author}\u0000${sync}`;
    void setDraftAudio(
      draftId,
      blob ? { blob, name, author, sync, bytes: blob.size } : null,
    );
  });

  // The credits are their own write. Reading them in the effect above would
  // put the whole file again on every keystroke — megabytes per character.
  $effect(() => {
    const { name, author, sync } = editor.audio;
    const credits = `${name}\u0000${author}\u0000${sync}`;
    if (credits === storedCredits || !untrack(() => editor.audio.hasTrack)) {
      return;
    }
    storedCredits = credits;
    void setDraftCredits(draftId, name, author, sync);
  });

  // Autosave on the reference's clock (AutoSave, every 60 s by default). A
  // trailing debounce was wrong here: with a minute-long interval a hand that
  // keeps drawing would reset it forever and never write anything.
  $effect(() => {
    const ms = editor.settings.autosaveMs;
    if (ms === 0 || saveFailed) {
      // «никогда» — Ctrl+S is the only way to disk; and after a failed write
      // the clock stays off until the page is reloaded (`toon.js:99-109`).
      return;
    }
    const timer = setInterval(() => {
      if (!dirty) {
        return;
      }
      // The reference defers a write until playback is over — `saveQueued`
      // writes it the moment the transport stops.
      if (editor.playing) {
        queued = true;
        return;
      }
      saveNow();
    }, ms);
    return () => clearInterval(timer);
  });

  // Drafts saved on this device. The reference keeps every local save and
  // greets you with "Доступно локальное сохранение!" rather than loading the
  // last one behind your back (`toonio.bundle.js:233`) — so does this: the
  // editor opens on a clean sheet and offers the list when there is one.
  let draftsOpen = $state(false);
  let drafts = $state<DraftEntry[]>([]);

  /** How much of the device's storage everything on it takes, for the header. */
  let storageUsed = $state(0);

  /**
   * Object URLs for the cards' screenshots, one per record. Made here rather
   * than in the markup: a URL minted while rendering is minted again on every
   * re-render, and every one of them pins its blob in memory for the session.
   */
  let thumbUrls = $state<Record<string, string>>({});

  async function refreshDrafts(): Promise<void> {
    drafts = draftEntries(await listDrafts());
    for (const url of Object.values(thumbUrls)) {
      URL.revokeObjectURL(url);
    }
    thumbUrls = Object.fromEntries(
      drafts.flatMap((entry) => (entry.screenshot ? [[entry.id, URL.createObjectURL(entry.screenshot)]] : [])),
    );
    storageUsed = (await navigator.storage?.estimate?.().catch(() => null))?.usage ?? 0;
  }

  /** Reference «копия»: the same drawing under a new key, the original untouched. */
  async function copyDraft(entry: DraftEntry): Promise<void> {
    await duplicateDraft(entry.id);
    await refreshDrafts();
  }

  /**
   * The record as a file, straight from the card — the same `.toonops` the
   * settings export writes, one save in it, so it comes back through the same
   * import with its screenshot, its track and the hand it was saved with.
   */
  async function downloadDraft(entry: DraftEntry): Promise<void> {
    const text = await exportDrafts([entry.id]);
    saveFile(new Blob([text], { type: 'application/json' }), 'draft.toonops');
  }

  async function removeAllDrafts(): Promise<void> {
    if (!askDelete(t('editor.drafts_wipe_confirm'))) {
      return;
    }
    await deleteAllDrafts();
    draftId = newDraftId();
    await refreshDrafts();
    await refocusDrafts(0);
  }

  /**
   * A deleted row takes its pressed key with it, and the focus would fall to
   * the page under the modal sheet. It goes to the row that took the place,
   * the one above when the last went, or «Закрыть» when none is left.
   */
  async function refocusDrafts(at: number): Promise<void> {
    await tick();
    const rows = draftsDialog?.querySelectorAll<HTMLButtonElement>('.draft-open') ?? [];
    (rows[Math.min(at, rows.length - 1)] ?? draftsDialog?.querySelector<HTMLButtonElement>('.sheet-foot .primary'))?.focus();
  }

  onMount(async () => {
    // One place the editor asks from — the state calls it for frames, layers
    // and pastes alike, and `Alt+Enter` mutes it inside `confirmed`.
    editor.ask = (message: string) => confirm(message);
    // The transport defers a write until the preview is over and tells us here.
    editor.onStop = saveQueued;
    // Ask the browser to keep the drafts: without this they are evictable the
    // moment the device is short of space.
    void navigator.storage?.persist?.().catch(() => false);
    await refreshDrafts();
    draftsOpen = drafts.length > 0 && editor.settings.showDraftsOnStart;
  });

  async function openDrafts(): Promise<void> {
    leaveFullscreen();
    await refreshDrafts();
    draftsOpen = true;
  }

  /** Loads a saved draft; the current drawing is replaced, so a touched one asks. */
  function openDraft(entry: DraftEntry): void {
    if (editor.touched) {
      if (!confirm(t('editor.draft_open_confirm'))) {
        return;
      }
      saveNow();
    }
    editor.openDraft(entry.doc);
    if (entry.state) {
      editor.restoreState(entry.state);
    }
    // Claimed before the restore, which is async: the effect must already know
    // this blob is the one on disk by the time the track is adopted.
    storedBlob = entry.audio?.blob ?? null;
    storedCredits = entry.audio
      ? `${entry.audio.name}\u0000${entry.audio.author}\u0000${entry.audio.sync ?? true}`
      : '';
    if (entry.audio) {
      void editor.audio.restore(entry.audio);
    } else {
      editor.audio.clear();
    }
    draftId = entry.id;
    draftsOpen = false;
  }

  async function removeDraft(entry: DraftEntry): Promise<void> {
    if (!askDelete(t('editor.draft_delete_confirm'))) {
      return;
    }
    const at = drafts.findIndex((d) => d.id === entry.id);
    await deleteDraft(entry.id);
    if (draftId === entry.id) {
      draftId = newDraftId();
    }
    await refreshDrafts();
    await refocusDrafts(at);
  }

  /** Reference Alt+Enter: with the warnings muted a delete just happens. */
  /**
   * Reference warning on the first mega-eraser of the session: the tool
   * rewrites the strokes of a cell in place, so the draft written right after
   * it is the way back.
   */
  const MEGA_ERASER_WARNING =
    t('editor.mega_eraser_warning');

  $effect(() => {
    if (editor.tool !== 'mega-eraser' || editor.megaEraserWarned) {
      return;
    }
    editor.megaEraserWarned = true;
    if (editor.warnings && editor.settings.megaEraserWarning) {
      megaWarnOpen = true;
    }
    saveNow();
  });

  function askDelete(message: string): boolean {
    return !editor.warnings || confirm(message);
  }

  let fileInput = $state<HTMLInputElement | undefined>();
  /** Import failure, shown until the next attempt. */
  let importError = $state('');

  /**
   * The one door every drawing comes in through: the file dialog and a drop on
   * the window. The decoder is picked by extension, as the reference does
   * (`bundle:7341-7355`) — `.toonop` is our own document, `.toon` the binary
   * Tonio file, `.json` its pre-binary save. The current drawing is replaced,
   * so a touched document asks first and its draft is written before it goes.
   */
  async function openFile(file: File): Promise<void> {
    importError = '';
    if (editor.touched) {
      if (!confirm(t('editor.file_open_confirm', { name: file.name }))) {
        return;
      }
      saveNow();
    }
    const name = file.name.toLowerCase();
    let doc: ToonDocument;
    let original = '';
    try {
      if (name.endsWith('.toonop')) {
        doc = loadDocument(JSON.parse(await file.text()));
      } else if (name.endsWith('.json')) {
        const result = decodeLegacyJson(await file.text());
        if (!result.ok) {
          importError = t('editor.file_failed', { reason: result.error });
          return;
        }
        doc = result.doc;
      } else if (name.endsWith('.toon')) {
        const result = decodeToon(await file.arrayBuffer());
        if (!result.ok) {
          importError = t('editor.file_failed', { reason: result.error });
          return;
        }
        doc = result.doc;
        original = result.original;
      } else {
        importError = t('editor.file_unsupported');
        return;
      }
    } catch (err) {
      // What throws here is our own document's validator — a JSON path and
      // a schema rule, which says nothing to the person holding the file.
      console.warn('file open failed:', err);
      importError = t('editor.file_failed', { reason: t('editor.file_not_toonop') });
      return;
    }
    adoptOpenedDoc(doc, original);
  }

  /**
   * What the reference does around a file it has just read: the drawing
   * replaces the current one, the grid takes the colours it uses, the track
   * goes (a file carries none) and the visit starts a new draft record so the
   * opened file does not overwrite what was being drawn before it.
   */
  function adoptOpenedDoc(doc: ToonDocument, original: string): void {
    editor.importDoc(doc);
    editor.original = original;
    editor.stealPalette(doc);
    editor.audio.clear();
    storedBlob = null;
    storedCredits = '';
    draftId = newDraftId();
  }

  /**
   * A file dropped anywhere on the window (`bundle:7341-7407`): a drawing
   * opens, a sound is attached, anything else is named rather than ignored.
   */
  function onDrop(e: DragEvent): void {
    const file = e.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    e.preventDefault();
    if (/\.(toonop|toon|json)$/i.test(file.name)) {
      void openFile(file);
    } else if (file.type.startsWith('audio/')) {
      void editor.audio.load(file, file.name.replace(/\.[^.]+$/, ''), editor.audio.author);
      audioOpen = true;
    } else {
      importError = t('editor.file_unsupported');
    }
  }
  // The reference's settings window: drawing, palette, autosave, view.
  let settingsSheetOpen = $state(false);

  function openSettingsSheet(): void {
    leaveFullscreen();
    settingsSheetOpen = true;
  }

  /** Installed plugins and the catalog — its own window, off the settings sheet. */
  let pluginsSheetOpen = $state(false);

  /**
   * «сохранено локально <дата> <размер>» on the panel — the reference names
   * the storage, when it last wrote and how heavy the record has become.
   */
  const lastSaved = $derived(
    editor.lastSavedAt === null
      ? ''
      : new Date(editor.lastSavedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  );

  // Reference «Мануал» (`E:61-63`) opens the site's manual page; we have none,
  // so the button opens the list of keys the editor actually implements.
  let manualOpen = $state(false);

  // Mirrors the key handler above one-for-one. If a case is added there and not
  // here, the sheet lies — keep them next to each other for that reason. A key
  // whose meaning the preset decides says this studio's meaning, and a tool key
  // shows only where the tool is on the panel.
  const has = (tool: string): boolean => editor.availableTools.includes(tool);
  const SHORTCUTS: [string, string][] = $derived(
    (
      [
        ['B', t('key.pencil')],
        ['E', t('key.eraser')],
        hasMegaEraser && ['Alt + E', t('tool.mega_eraser.label')],
        ['P', t('key.pipette')],
        has('drag') && ['D / O', t('tool.hand.label')],
        has('lasso') && ['Q / S', t('tool.transform.label')],
        has('distort') && ['~', t('tool.jitter.label')],
        ['H / Shift + H', t('key.mirror')],
        ['+ / −', t('key.brush_size')],
        ['M', quickPalette ? t('key.palette') : t('key.merge')],
        ['Z', t('key.undo')],
        ['Y', t('key.redo')],
        ['C', t('key.copy')],
        ['V', t('key.paste')],
        ['F', hasFeather ? t('tool.feather.label') : t('key.fullscreen')],
        ['A', t('key.add_frame')],
        ['Del', t('key.delete_frame')],
        ['J / L', t('key.ends')],
        ['← / →', t('key.steps')],
        ['↑ / ↓', t('key.layers')],
        ['Shift + ←→↑↓', t('key.extend')],
        ['K', t('key.onion')],
        ['X', t('key.swap')],
        ['Space', t('key.preview')],
        ['Ctrl + S', t('key.save')],
        ['Alt + S', hasProjectFile ? t('key.download_project') : t('key.export')],
        ['Alt + Enter', t('key.no_warnings')],
        ['Alt + L', t('key.error_log')],
      ] as ([string, string] | false)[]
    ).filter((row): row is [string, string] => row !== false),
  );

  // Copy/paste confirmation: the reference flashes the whole stage for 50 ms
  // (fadeSprite). Skipped under reduced motion.
  let flashVisible = $state(false);
  $effect(() => {
    if (editor.flashTick === 0) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    flashVisible = true;
    const timer = setTimeout(() => (flashVisible = false), 50);
    return () => clearTimeout(timer);
  });

  function onAddFrame(e: MouseEvent): void {
    if (e.ctrlKey) {
      editor.addFrameBeforeActive();
    } else {
      editor.addFrameAfterActive();
    }
  }

  const lastFrame = $derived(editor.doc.layers[0].frames.length - 1);

  function onFpsChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    editor.setFps(Number(input.value));
    input.value = String(editor.doc.frame_rate);
  }
</script>

<!-- A file dropped anywhere would otherwise navigate the page away from the
     unsaved drawing, so the window takes the drop and opens it instead. -->
<svelte:document onfullscreenchange={() => (isFullscreen = document.fullscreenElement !== null)} />

<svelte:window
  bind:innerHeight={viewportHeight}
  bind:innerWidth={viewportWidth}
  onkeydown={onKeydown}
  onpointermove={onDividerMove}
  onpointerup={onDividerUp}
  onpointercancel={onDividerUp}
  ondragover={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()}
  ondrop={onDrop}
  onbeforeunload={(e) => {
    // Unsaved strokes on a sheet that has something on it: the browser's own
    // dialog is the last thing between them and a closed tab.
    if (editor.touched && dirty && !isEmptyDocument(editor.doc)) {
      e.preventDefault();
    }
  }}
/>

<input
  bind:this={fileInput}
  type="file"
  hidden
  accept=".toonop,.toon,.json"
  aria-label={t('editor.open_project')}
  onchange={(e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) {
      void openFile(file);
    }
  }}
/>

{#snippet history()}
  <button
    class="key"
    disabled={!editor.canUndo}
    onclick={() => editor.undo()}
    data-key="Z"
    title={t('editor.undo_title')}
    aria-label={t('editor.undo')}
  >
    <Icon name="undo" />
  </button>
  <button
    class="key"
    disabled={!editor.canRedo}
    onclick={() => editor.redo()}
    data-key="Y"
    title={t('editor.redo_title')}
    aria-label={t('editor.redo')}
  >
    <Icon name="redo" />
  </button>
{/snippet}

<!-- The column's inner edge: the border line, the drag band on top of it and
     the round fold handle in the middle of it. It is a grid item of its own —
     inside the column, its own scrolling would cut the circle in half. -->
{#snippet sideEdge(id: SideId, label: string)}
  <div
    class="side-edge edge-{id}"
    class:folded={folded(id)}
    class:at-left={atLeft(id)}
    class:dragging={resize?.side === id}
  >
    {#if !folded(id)}
      <!-- A focusable separator is a window splitter widget (ARIA 1.2), which
           svelte-check's non-interactive rules do not model. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="side-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('editor.panel_width', { label })}
        aria-valuenow={sideWidth(id)}
        aria-valuemin={SIDE_WIDTH_MIN[id]}
        aria-valuemax={SIDE_WIDTH_MAX}
        tabindex="0"
        onpointerdown={(e) => onSideDown(e, id)}
        onkeydown={(e) => onSideKey(e, id)}
        title={t('editor.panel_width_title')}
      ></div>
    {/if}
    <!-- The arrow points the way the panel is about to travel. -->
    <button
      class="fold"
      onclick={() => editor.toggleSide(id)}
      aria-expanded={!folded(id)}
      title={folded(id) ? t('editor.panel_expand') : t('editor.panel_fold')}
      aria-label={t('editor.panel_toggle', { action: folded(id) ? t('editor.expand') : t('editor.fold'), label })}
    >
      <Icon name={foldIcon(id, folded(id))} size={14} />
    </button>
  </div>
{/snippet}

<!-- Every movable piece of chrome, by id: which panel holds it, and in what
     order, comes from the config (panels.ts) — not from its place in this
     file. The gear and Publish are the two exceptions below. -->
{#snippet panelItem(id: string)}
  {@const tool = toolOfItem(id)}
  {#if tool}
    <ToolKey {editor} {tool} />
  {:else if id === 'save'}
    <!-- Reference «Сохранить»: the draft goes to disk now rather than on the
         next turn of the autosave clock. Nothing to write, nothing to press. -->
    <button
      class="key icon"
      onclick={() => saveNow(true)}
      disabled={!dirty}
      data-key="Ctrl+S"
      title={t('editor.save_title')}
      aria-label={t('editor.save')}
    >
      <Icon name="save" />
    </button>
  {:else if id === 'history'}
    <div class="history">
      {@render history()}
    </div>
  {:else if id === 'manual'}
    <!-- Reference «Мануал» (`E:61-63`): the keys, with no key of its own. -->
    <button class="key icon" onclick={() => (manualOpen = true)} title={t('editor.manual')} aria-label={t('editor.manual')}>
      <Icon name="help" />
    </button>
  {:else if id === 'fullscreen'}
    {#if document.fullscreenEnabled}
      <button
        class="key icon"
        class:active={isFullscreen}
        aria-pressed={isFullscreen}
        onclick={toggleFullscreen}
        data-key="F"
        title={t('editor.fullscreen_title')}
        aria-label={t('editor.fullscreen')}
      >
        <Icon name="expand" />
      </button>
    {/if}
  {:else if id === 'drafts'}
    <button class="key icon" onclick={openDrafts} title={t('editor.drafts_key')} aria-label={t('editor.drafts_key')}>
      <Icon name="drafts" />
    </button>
  {:else if id === 'palette'}
    <PaletteBox {editor} />
  {:else if id === 'color'}
    <ColorPanel {editor} />
  {:else if id === 'brush'}
    <BrushPanel {editor} />
  {:else if id === 'brush-sizes'}
    <BrushSizes {editor} />
  {:else if id === 'timeline'}
    <div class="timeline">
      <Timeline {editor} />
    </div>
  {:else if id === 'transport'}
    <!-- One control: ⏮ ⏴ ▶ ⏵ ⏭ travel together, the way a transport reads. -->
    <div class="transport-keys" role="group" aria-label={t('editor.transport')}>
        <button
          class="key icon ends"
          disabled={editor.playing || editor.activeFrame === 0}
          onclick={() => editor.selectFrame(0)}
          title={t('editor.first_frame')}
          aria-label={t('editor.first_frame')}
        ><Icon name="frame-first" /></button>
        <button
          class="key icon"
          disabled={editor.playing || lastFrame === 0}
          onclick={() => editor.selectFrame(wrapIndex(editor.activeFrame - 1, lastFrame + 1))}
          title={t('editor.prev_frame')}
          aria-label={t('editor.prev_frame')}
        ><Icon name="frame-prev" /></button>
      <PlayControls bind:this={playControls} {editor} />
        <button
          class="key icon"
          disabled={editor.playing || lastFrame === 0}
          onclick={() => editor.selectFrame(wrapIndex(editor.activeFrame + 1, lastFrame + 1))}
          title={t('editor.next_frame')}
          aria-label={t('editor.next_frame')}
        ><Icon name="frame-next" /></button>
        <button
          class="key icon ends"
          disabled={editor.playing || editor.activeFrame >= lastFrame}
          onclick={() => editor.selectFrame(lastFrame)}
          title={t('editor.last_frame')}
          aria-label={t('editor.last_frame')}
        ><Icon name="frame-last" /></button>
    </div>
  {:else if id === 'add-frame'}
    <button
      class="key"
      disabled={editor.playing}
      onclick={onAddFrame}
      data-key="A"
      title={t('editor.add_frame_title')}
      aria-label={t('editor.add_frame')}
    >
      <Icon name="plus" />
    </button>
  {:else if id === 'delete-frame'}
    <button
      class="key"
      disabled={editor.playing || !editor.canRemoveFrame}
      onclick={() => editor.removeActiveFrame()}
      data-key="Del"
      title={t('editor.delete_frame_title')}
      aria-label={t('editor.delete_frame')}
    >
      <Icon name="trash" />
    </button>
  {:else if id === 'onion'}
    <button
      class="key"
      class:active={editor.onionSkin}
      aria-pressed={editor.onionSkin}
      onclick={() => editor.toggleOnionSkin()}
      data-key="K"
      title={editor.onionSkin ? t('editor.onion_on') : t('editor.onion_off')}
      aria-label={t('editor.onion')}
    >
      <Icon name="onion" />
    </button>
  {:else if id === 'fps'}
    <!-- The reference keeps fps on the bar itself: a slider and a box. -->
    <label class="fps-inline" title={t('editor.fps')}>
      <span class="sr-only">{t('editor.fps')}</span>
      <input
        type="range"
        min={editor.ux.fpsRange[0]}
        max={editor.ux.fpsRange[1]}
        value={editor.doc.frame_rate}
        oninput={onFpsChange}
        disabled={editor.playing}
      />
      <input
        type="number"
        min={editor.ux.fpsRange[0]}
        max={editor.ux.fpsRange[1]}
        value={editor.doc.frame_rate}
        onchange={onFpsChange}
        disabled={editor.playing}
        aria-label={t('editor.fps')}
      />
    </label>
  {:else if id === 'audio'}
    <!-- The soundtrack lives behind its own key, beside layers and export:
         the wave belongs on the timeline, the file and its credits do not. -->
    <div class="layers">
      <button
        class="key"
        class:active={audioOpen}
        aria-expanded={audioOpen}
        bind:this={audioKey}
        onclick={() => (audioOpen = !audioOpen)}
        title={editor.audio.hasTrack ? t('editor.audio_of', { name: editor.audio.name || t('editor.audio_unnamed') }) : t('editor.audio')}
        aria-label={t('editor.audio')}
      >
        <Icon name="note" />
      </button>
      {#if audioOpen}
        <AudioPanel {editor} anchor={audioKey} onClose={() => (audioOpen = false)} />
      {/if}
    </div>
  {:else if id === 'export'}
    <ExportSheet
      bind:this={exportButton}
      {editor}
      onOpen={() => {
        saveNow();
        leaveFullscreen();
      }}
    />
  {:else if id === 'saved'}
    <!-- One region, there before its first word: a live region inserted
         together with its text is often not announced at all. A failed save
         is urgent, so it interrupts; a saved one waits its turn. -->
    <span
      class="saved save-status {saveFailed ? 'too_big' : lastSaved ? draftSizeClass(savedBytes) : ''}"
      role={saveFailed ? 'alert' : 'status'}
    >
      {#if saveFailed}
        <Icon name="x" size={14} /> {t('editor.save_failed')}
      {:else if lastSaved}
        {t('editor.saved_at', { when: lastSaved, size: formatFileSize(savedBytes) })}
      {/if}
    </span>
  {:else if id === 'copy'}
    <button
      class="key icon"
      disabled={editor.playing}
      onclick={() => editor.copySelection()}
      data-key="C"
      title={t('editor.copy_title')}
      aria-label={t('editor.copy')}
    ><Icon name="copy" /></button>
  {:else if id === 'paste'}
    <button
      class="key icon"
      disabled={!editor.canPasteCells}
      onclick={() => editor.pasteSelection()}
      data-key="V"
      title={t('editor.paste_title')}
      aria-label={t('editor.paste')}
    ><Icon name="paste" /></button>
  {:else if id === 'settings'}
    <!-- Movable, never hideable: this key is the way back to the settings. -->
    <button
      class="key icon"
      aria-haspopup="dialog"
      onclick={openSettingsSheet}
      title={t('editor.settings')}
      aria-label={t('editor.settings')}
    >
      <Icon name="gear" />
    </button>
  {:else if id === 'publish'}
    {#if onPublish}
      <!-- One key like any other: where it sits is the arrangement's business,
           not a zone fenced off in the markup. -->
      <button
        class="key primary publish"
        onclick={() =>
          onPublish?.(
            $state.snapshot(editor.doc),
            editor.audio.blob
              ? {
                  blob: editor.audio.blob,
                  name: editor.audio.name,
                  author: editor.audio.author,
                  sync: editor.audio.sync,
                }
              : null,
          )}
        title={t('editor.publish')}
        aria-label={t('editor.publish')}
      >
        <Icon name="send" />
      </button>
    {/if}
  {:else if id === 'merge'}
    <button
      class="key icon"
      disabled={!editor.canPasteCells}
      onclick={() => editor.mergeSelection()}
      data-key="M"
      title={t('editor.merge_title')}
      aria-label={t('editor.merge')}
    ><Icon name="merge" /></button>
  {/if}
{/snippet}

<!-- In arrange mode every item wears a handle: the wrapper takes the pointer
     (its contents stop taking clicks) and carries the id the arranger drags. -->
{#snippet slot(items: string[])}
  {#each items as id (id)}
    {#if editor.arranging}
      <div
        class="arr"
        class:wide={panelItemSpec(id)?.wide}
        data-item={id}
        title={t('editor.drag_item', { label: panelItemSpec(id)?.label ?? id })}
      >
        {@render panelItem(id)}
      </div>
    {:else}
      {@render panelItem(id)}
    {/if}
  {/each}
  {#if editor.arranging && items.length === 0}
    <span class="slot-empty">{t('editor.slot_empty')}</span>
  {/if}
{/snippet}


<div
  class="editor studio"
  class:alt={editor.settings.altLayout}
  class:arranging={editor.arranging}
  data-float-root
  bind:this={editorEl}
>
  {#if editor.panels.left.length > 0 || editor.arranging}
    <aside
      class="left"
      class:collapsed={folded('left')}
      aria-label={t('editor.tools_side')}
      data-slot="left"
      style={sideStyle('left')}
      bind:clientWidth={sidePx.left}
    >
      {#if !folded('left')}
        {@render slot(editor.panels.left)}
      {/if}
    </aside>
    {@render sideEdge('left', t('editor.tools_side'))}
  {/if}
  <div class="stage" data-slot="float">
    <CanvasView {editor} />
    {@render stageNote?.()}
    <!-- The reference's two floating tool windows: the transform fields while
         a selection is live, the zoom window while the hand is up. They sit
         over the canvas, not in the tool rail, which is only 8.4rem wide. -->
    {#if editor.transform || pipetteUp || editor.pluginWindow}
      <div class="tool-windows">
        {#if editor.pluginWindow}
          <!-- A window a tool brought with it: the editor draws the frame and
               the title, the tool fills the body with whatever it likes. -->
          <div class="pick-window" role="group" aria-label={editor.pluginWindow.title}>
            <p class="pick-title">{editor.pluginWindow.title}</p>
            <div bind:this={pluginSlot}></div>
          </div>
        {/if}
        {#if editor.transform}
          <TransformMenu {editor} />
        {/if}
        {#if pipetteUp}
          <!-- Where the pipette reads from. It comes up with the pipette and
               goes with it, like the zoom window with the hand: on a panel it
               was a pair of keys sitting dead most of the time. -->
          <div class="pick-window" role="group" aria-label={t('editor.pick_source')}>
            <p class="pick-title">{t('editor.pipette')}</p>
            <div class="pick-source">
              {#each [['canvas', t('editor.pick_canvas')], ['layer', t('editor.pick_layer')]] as [source, label] (source)}
                <button
                  class="key"
                  class:active={editor.pickSource === source}
                  aria-pressed={editor.pickSource === source}
                  onclick={() => editor.setPickSource(source as 'canvas' | 'layer')}
                  title={source === 'canvas'
                    ? t('editor.pick_canvas_title')
                    : t('editor.pick_layer_title')}
                >{label}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
    <!-- The only zoom control there is, so it is always on the canvas: in the
         far corner, faded back until the hand is up, the wheel turns, or it is
         hovered or focused. -->
    <div class="scale-window">
      <ScaleMenu {editor} />
    </div>
    {#if flashVisible}
      <div class="flash" aria-hidden="true"></div>
    {/if}
    {#if importError}
      <p class="import-error" role="alert">
        {importError}
        <button class="key" onclick={() => (importError = '')} aria-label={t('editor.close_message')}>
          <Icon name="x" size={16} />
        </button>
      </p>
    {/if}
  </div>
  {#if editor.panels.right.length > 0 || editor.arranging}
    <aside
      class="right"
      class:collapsed={folded('right')}
      aria-label={t('editor.palette_side')}
      data-slot="right"
      style={sideStyle('right')}
      bind:clientWidth={sidePx.right}
    >
      {#if !folded('right')}
        {@render slot(editor.panels.right)}
      {/if}
    </aside>
    {@render sideEdge('right', t('editor.palette_side'))}
  {/if}
  <!-- A panel with nothing in it is not drawn — the canvas takes the room. -->
  {#if editor.panels.rows.length > 0 || editor.arranging}
  <div
    class="panel"
    class:collapsed={panelFolded}
    class:dragging={resize?.side === 'panel'}
    style={!panelFolded && !editor.arranging ? `height: ${panelHeight}px` : undefined}
  >
    <!-- The bar folds like the columns do: the same key-shaped tab, lying on
           its side at the corner of its seam. -->
      <button
        class="fold lying"
        onclick={() => editor.togglePanel()}
        aria-expanded={!panelFolded}
        title={panelFolded ? t('editor.panel_expand') : t('editor.panel_fold')}
        aria-label={panelFolded ? t('editor.bottom_expand') : t('editor.bottom_fold')}
      >
        <Icon name={panelFolded ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
    {#if !panelFolded}
      <!-- A focusable separator is a window splitter widget (ARIA 1.2), which
           svelte-check's non-interactive rules do not model. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="resizer"
        role="separator"
        aria-label={t('editor.bottom_height')}
        aria-orientation="horizontal"
        aria-valuenow={panelHeight}
        aria-valuemin={panelFloor}
        aria-valuemax={Math.max(panelFloor, Math.round((viewportHeight || 800) * 0.75))}
        tabindex="0"
        onpointerdown={(e) =>
          startResize(e, 'y', -1, panelHeight, (px) => editor.setPanelHeight(px), 'panel')}
        onkeydown={onDividerKey}
        title={t('editor.bottom_height_title')}
      ></div>
    {/if}
    {#if !panelFolded}
      <!-- However many rows the arrangement has, top to bottom. A row that
           empties is gone (panels.ts), so no unreachable strip is left; a new
           row is made by dragging past a row's top or bottom edge, so nothing
           has to stand there holding a place open. -->
      <div class="toolbar">
        {#each editor.panels.rows as row, i (i)}
          <div
            class="row"
            role="group"
            aria-label={t('editor.row_n', { n: i + 1 })}
            data-slot="row:{i}"
            bind:contentRect={rowBoxes[i]}
          >
            {@render slot(row)}
          </div>
        {/each}
      </div>
    {/if}
  </div>
  {/if}

  <!-- Items taken off the panels: windows over the whole editor — the canvas
       and the panels alike — so folding a column never moves them. -->
  {#each editor.panels.float as id (id)}
    <FloatWindow {editor} {id}>
      {@render panelItem(id)}
    </FloatWindow>
  {/each}

  {#if editor.arranging}
    <PanelArranger {editor} />
  {/if}

  <!-- Drafts sheet: every local save with its first frame, newest first.
       A native <dialog>, like the settings and plugins sheets: showModal()
       brings the focus trap, the Esc key and an inert page behind it. The
       hand-rolled version claimed `aria-modal` without any of the three, and
       its Esc was bound to a backdrop that never received a key. -->
  {#if draftsOpen}
    <dialog
      bind:this={draftsDialog}
      class="sheet sheet-dialog"
      aria-label={t('editor.drafts')}
      onclose={() => (draftsOpen = false)}
    >
      <header class="sheet-head">
        <h2>{t('editor.drafts')}</h2>
        <button class="key icon" onclick={() => draftsDialog?.close()} aria-label={t('editor.close')}>
          <Icon name="x" />
        </button>
      </header>

      <div class="sheet-body">
        {#if drafts.length === 0}
          <p class="empty">{t('editor.drafts_empty')}</p>
        {:else}
          <p class="sheet-hint">
            {t('draft.count', { count: drafts.length })}{t('editor.on_this_device')}
            {#if storageUsed}{t('editor.storage_used', { size: formatFileSize(storageUsed) })}{/if}
          </p>
          <ul class="drafts">
            {#each drafts as entry (entry.id)}
              <li class="draft">
                <button class="draft-open" onclick={() => openDraft(entry)}>
                  <span class="draft-thumb">
                    {#if thumbUrls[entry.id]}
                      <!-- The still written with the record: no document to
                           re-render, and it is what the drawing looked like. -->
                      {@const box = fitThumb(entry.doc.width, entry.doc.height, 44)}
                      <img src={thumbUrls[entry.id]} alt="" width={box.w} height={box.h} />
                    {:else}
                      <FrameThumb doc={entry.doc} frameIndex={0} maxW={44} />
                    {/if}
                  </span>
                  <span class="draft-meta">
                    <span class="draft-date">{new Date(entry.updated).toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    <span class="draft-size">
                      {t('draft.frames', { count: entry.doc.layers[0].frames.length })} ·
                      {t('draft.layers', { count: entry.doc.layers.length })}
                      {#if entry.bytes}
                        · <span class={draftSizeClass(entry.bytes)}>{formatFileSize(entry.bytes)}</span>
                      {/if}
                    </span>
                    {#if entry.audio}
                      <span class="draft-track">
                        <Icon name="note" size={13} />
                        {entry.audio.author ? t('draft.track_by', { author: entry.audio.author }) : ''}{entry.audio.name || t('editor.audio_unnamed')}
                      </span>
                    {/if}
                  </span>
                </button>
                <!-- The three keys travel together: where the row wraps, they
                     go under the date as one group, not one by one. -->
                <span class="draft-keys">
                <button
                  class="key icon"
                  onclick={() => copyDraft(entry)}
                  title={t('editor.draft_copy_title')}
                  aria-label={t('editor.draft_copy')}
                >
                  <Icon name="copy" />
                </button>
                <button
                  class="key icon"
                  onclick={() => downloadDraft(entry)}
                  title={t('editor.draft_download_title')}
                  aria-label={t('editor.draft_download')}
                >
                  <Icon name="download" />
                </button>
                <button
                  class="key icon"
                  onclick={() => removeDraft(entry)}
                  title={t('editor.draft_delete_title')}
                  aria-label={t('editor.draft_delete')}
                >
                  <Icon name="trash" />
                </button>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <footer class="sheet-foot">
        {#if drafts.length > 0}
          <button class="key" onclick={removeAllDrafts}>{t('editor.drafts_wipe')}</button>
        {/if}
        <button class="key primary" onclick={() => draftsDialog?.close()}>{t('editor.close')}</button>
      </footer>
    </dialog>
  {/if}

  {#if settingsSheetOpen}
    <SettingsSheet
      {editor}
      onClose={() => (settingsSheetOpen = false)}
      onSaveNow={() => saveNow(true)}
      onOpenFile={() => fileInput?.click()}
      onOpenDrafts={openDrafts}
      onOpenPlugins={() => (pluginsSheetOpen = true)}
    />
  {/if}

  {#if pluginsSheetOpen}
    <PluginsSheet {editor} onClose={() => (pluginsSheetOpen = false)} />
  {/if}

  <!-- The lock: an update is coming down, and nothing else is to be touched
       while it does. Esc does not call it off — there is nothing to call off. -->
  <dialog class="updating" bind:this={updatingEl} aria-labelledby="editor-updating" oncancel={(e) => e.preventDefault()}>
    <p id="editor-updating">{t('editor.plugins_updating')}</p>
  </dialog>

  <!-- Customization sheet: roomy, one concern per row, big tap targets. -->
  <!-- (SHORTCUTS is declared in the script block above.) -->
  {#if manualOpen}
    <dialog
      bind:this={manualDialog}
      class="sheet sheet-dialog"
      aria-label={t('editor.manual')}
      onclose={() => (manualOpen = false)}
    >
      <header class="sheet-head">
        <h2>{t('editor.manual')}</h2>
        <button class="key icon" onclick={() => manualDialog?.close()} aria-label={t('editor.close')}>
          <Icon name="x" />
        </button>
      </header>

      <!-- Nothing inside takes focus, so the body itself does: otherwise the
           arrow keys have nowhere to scroll the list from. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="sheet-body" tabindex="0">
        <!-- Every shortcut the key handler above actually implements, in one
             place. They were reachable but undocumented: nothing in the UI said
             the editor had any. Behind the sheet, so the toolbar stays quiet. -->
        <p class="sheet-hint">{t('editor.shortcuts')}</p>
        <dl class="keylist">
          {#each SHORTCUTS as [combo, what] (combo)}
            <div class="keyrow">
              <dt><kbd>{combo}</kbd></dt>
              <dd>{what}</dd>
            </div>
          {/each}
        </dl>
      </div>

      <footer class="sheet-foot">
        <button class="key primary" onclick={() => manualDialog?.close()}>{t('editor.done')}</button>
      </footer>
    </dialog>
  {/if}

  {#if megaWarnOpen}
    <dialog
      bind:this={megaWarnDialog}
      class="sheet sheet-dialog"
      aria-labelledby="mega-warn-title"
      aria-describedby="mega-warn-text"
      onclose={() => (megaWarnOpen = false)}
    >
      <header class="sheet-head">
        <h2 id="mega-warn-title">{t('editor.mega_eraser_title')}</h2>
        <button class="key icon" onclick={() => megaWarnDialog?.close()} aria-label={t('editor.close')}>
          <Icon name="x" />
        </button>
      </header>
      <div class="sheet-body">
        <p id="mega-warn-text">{MEGA_ERASER_WARNING}</p>
        <label class="mute-warning">
          <input
            type="checkbox"
            checked={!editor.settings.megaEraserWarning}
            onchange={(e) => editor.setSetting('megaEraserWarning', !e.currentTarget.checked)}
          />
          {t('editor.dont_show_again')}
        </label>
      </div>
      <footer class="sheet-foot">
        <button class="key primary" onclick={() => megaWarnDialog?.close()}>{t('editor.got_it')}</button>
      </footer>
    </dialog>
  {/if}
</div>

<style>
  /* The brand table (ink / paper / canvas / signal / accent) comes from
     `tokens.css`, imported above: one file, read by the editor and by the site
     that embeds it. What is left here is the editor's own chrome — the
     worktable tone, the key height, the bleed — which no other surface has.
     Declared on `.editor` so every child inherits through the DOM; scoped
     styles still resolve `var(--…)` at runtime. */
  .editor {
    /* The z ladder in tokens.css is one context, and this is it: without it
       the timeline head (z 1) painted over the host page's publish message. */
    isolation: isolate;
    /* The worktable: one tonal step under the chrome, same blue bias. Four
       surfaces read apart without a single extra line — panels on paper, the
       drawing on white, the table between them. */
    --table: #d7dfee;
    /* Layer tags: six hues cycling by row position, a display aid only — the
       document stores no colour. Kept muted so a column of them reads as
       stripes beside the names rather than competing with the drawing. Six
       hues, none of them in the signal band: The Signal Rule reserves red for
       «рисовать» and names icons and borders as off-limits, and the written
       carve-out in DESIGN §2 covers paint inside a drawing (the mascot), not
       interface chrome. The fourth was #c0392b, 6° from the signal. */
    --layer-tag-0: var(--electric);
    --layer-tag-1: #00997a;
    --layer-tag-2: #b8860b;
    --layer-tag-3: #c2185b;
    --layer-tag-4: #7d3cc7;
    --layer-tag-5: #0f7d9e;
    /* The copy/paste flash over the canvas: the reference's 0xCCCCCC at 0.9,
       kept to the value because parity is the point of it. */
    --flash: #cccccce6;
    /* WCAG/DESIGN tap floor — every key is at least 44x44. */
    --key-h: 2.75rem;
    /* How far a control paints outside its own box: the focus ring (3px at
       2px offset) is the widest, then the active swatch's 2px ring and the
       key's 2px shadow. Anything that scrolls has to leave this much room,
       or it shaves those off at its edge. */
    --bleed: 6px;

    /* Frame for the floating windows: they live over the whole editor, not
       over the canvas, so folding a column does not move them. */
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    color: var(--text);
    font-family: var(--font-body);
    /* Reference .draw: nothing here is prose, so a drag across the chrome —
       the panel resizer above all — never leaves a blue smear behind. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  /* The fields you do type in keep their selection. */
  .editor input {
    user-select: text;
    -webkit-user-select: text;
  }
  /* Paper worktable so the white sheet floats on brand tone, not a bare
     letterbox. No padding: the table runs to the bars, and the air around the
     sheet is the fit's own margin — otherwise a magnified sheet reads as cut
     off by a grey frame. */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--table);
    box-sizing: border-box;
  }
  .tool-windows {
    position: absolute;
    left: clamp(0.5rem, 2.2vw, 1.25rem);
    top: clamp(0.5rem, 2.2vw, 1.25rem);
    z-index: var(--z-tool);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 13rem;
    /* Ends above the zoom window in the same corner column (its keys and 2px
       inset): a tall transform window ran under it at large text. */
    max-height: calc(100% - 3 * clamp(0.5rem, 2.2vw, 1.25rem) - var(--key-h, 2.75rem) - 4px);
    overflow-y: auto;
  }
  .scale-window {
    position: absolute;
    left: clamp(0.5rem, 2.2vw, 1.25rem);
    bottom: clamp(0.5rem, 2.2vw, 1.25rem);
    z-index: var(--z-tool);
    /* One row of keys — it takes the width it needs, not a panel's. */
    width: max-content;
  }
  /* Quiet at rest is the window's own business now (ScaleMenu.svelte): it is
     the fill that steps back, not the window, so the readout and the edge keep
     their contrast while the hand is down. */
  /* On a phone the stage is short — a floating window would cover the drawing,
     so the windows sit under the canvas and span the width.
     Un-floating them is only half of that: a static child needs a row, and the
     stage is a frame the canvas fills edge to edge. Without the other half the
     zoom window laid itself out past the stage's own bottom, under the panel
     that comes next — present in the tree, with geometry, and neither visible
     nor pressable. So the stage becomes a column here and the canvas gives the
     rows back: `height: 100%` on the wrap would resolve against the whole
     stage and push its siblings straight out again. */
  @media (max-width: 40rem) {
    .stage {
      display: flex;
      flex-direction: column;
    }
    /* Half the stage stays the canvas's whatever window is up: the transform
       one, unfolded, took all of it, and with it the handles it is for. */
    .stage > :global(.wrap) {
      flex: 1 0 50%;
      min-height: 0;
      height: auto;
    }
    .tool-windows,
    .scale-window {
      position: static;
      flex: none;
      width: auto;
      max-height: none;
      margin-top: 0.5rem;
    }
    .tool-windows {
      flex: 0 1 auto;
      min-height: 0;
      overflow-y: auto;
    }
  }
  /* Copy/paste flash — the reference's 0xCCCCCC @ 0.9 fadeSprite. The value is
     parity and cannot move; what it can do is be declared, like the worktable
     and the layer tags above, so the table knows about it. */
  .flash {
    position: absolute;
    inset: 0;
    z-index: var(--z-flash);
    background: var(--flash);
    pointer-events: none;
  }
  /* Bottom toolbar — the second neutral layer over the white canvas. */
  .panel {
    flex: none;
    box-sizing: border-box;
    background: var(--paper);
    border-top: 1px solid var(--hairline);
    padding: 0.6rem 0.9rem;
  }
  .studio .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    /* The divider owns the height: the strip scrolls its layers inside it and
       a row too tall for it scrolls too, rather than growing the panel over
       the canvas or past the bottom of the window. `clip` with a margin so a
       key's shadow is not shaved off at the edge — and so the furniture that
       straddles the seam on purpose survives it: the drag band 8px above the
       edge and the fold tab 15px above it, plus that tab's focus ring (3px
       at 2px offset) and the 1px the tab lifts under the cursor. The margin is
       uniform, so it is the tallest of them: 15 + 3 + 2 + 1. */
    max-height: 75dvh;
    overflow: clip;
    overflow-clip-margin: 21px;
  }
  /* Reference #resizer: a 16px band straddling the panel's top edge, so the
     grab target is not the 1px border. (`.divider` is taken — it is the hair
     rule inside the settings popover.) */
  .resizer {
    position: absolute;
    top: -8px;
    left: 0;
    width: 100%;
    height: 16px;
    cursor: ns-resize;
    touch-action: none;
  }
  /* Same seam language as the columns: drawn only while it is in use. */
  .resizer:hover,
  .panel.dragging .resizer {
    background: linear-gradient(var(--accent), var(--accent)) center / 100% 2px no-repeat;
  }
  .resizer:focus-visible {
    outline: none;
    background: linear-gradient(var(--accent), var(--accent)) center / 100% 3px no-repeat;
  }
  /* The bar's own tab: the side tab turned on its side, at the corner of the
     seam where the tools column ends. */
  .fold.lying {
    top: auto;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    width: var(--key-h);
    height: 15px;
    border-bottom: none;
    border-radius: var(--r-sm) var(--r-sm) 0 0;
    box-shadow: none;
  }
  .fold.lying:hover {
    transform: translate(-50%, -1px);
  }
  .fold.lying:active {
    transform: translateX(-50%);
  }
  /* Folded, the bar is a strip with its tab on it. */
  .studio .panel.collapsed {
    height: 0.75rem;
    padding: 0;
  }
  .panel.collapsed .fold,
  .side-edge.folded .fold {
    background: color-mix(in srgb, var(--canvas) 55%, transparent);
  }
  .panel.collapsed .fold:hover,
  .panel.collapsed .fold:focus-visible,
  .side-edge.folded .fold:hover,
  .side-edge.folded .fold:focus-visible {
    background: var(--sub);
  }
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .studio .toolbar {
    /* The rows scroll when they have to, and a scroll box clips at its own
       padding edge — which shaved the electric ring and the drop shadow off
       the keys and swatches sitting against it. The padding gives that paint
       its room; the negative margin puts the rows back where they were. */
    overflow-y: auto;
    padding: var(--bleed);
    margin: calc(-1 * var(--bleed));
  }
  /* The timeline is the row that takes the height the divider hands out. */
  .studio .toolbar {
    flex: 1;
    min-height: 0;
  }
  /* The strip is the row that takes the height the divider hands out — the
     row it is in, not a fixed one: it can be moved. */
  .studio .row:has(.timeline) {
    flex: 1;
    min-height: 0;
    /* The strip is a tall grid, so the keys beside it sit at its top rather
       than floating in the middle of it — the strip itself stretches. */
    align-items: flex-start;
  }
  .studio .row:has(.timeline) > .timeline,
  .studio .row:has(.timeline) > .arr:has(.timeline) {
    align-self: stretch;
    min-height: 0;
  }
  .studio .timeline {
    height: 100%;
    min-height: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    /* The rows hold whatever the config puts in them, so a full one wraps
       rather than widening the page into a horizontal scroll. */
    flex-wrap: wrap;
  }
  /* ---- Arrange mode ----
     Every item becomes a handle: a dashed box that takes the pointer, with
     its contents frozen underneath so a drag never presses a button. */
  .editor.arranging .arr {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 2px;
    /* The handle is the item plus 2px, centred in whatever cell it lands in:
       stretched, it stood off the key by the cell's spare width and height
       instead of framing it. */
    place-self: center;
    /* The frame goes round the key, not across it: the padding box is the
       key plus 2px, and the radius follows it, so the corners clear the
       key's own 7px ones. */
    border-radius: calc(var(--r-sm) + 2px);
    outline: 2px dashed var(--accent);
    cursor: grab;
    touch-action: none;
  }
  /* Whatever takes the whole row — the strip, the palette box — still does. */
  .editor.arranging .arr.wide {
    place-self: stretch;
  }
  .editor.arranging .arr > :global(*) {
    pointer-events: none;
    /* The item grows into the whole handle, so the frame keeps its 2px on
       every side where the grid cell is wider than the key — from its own
       width, never below it, or the bar's keys lose their square. Its shadow
       goes with it: nothing is pressed while things are being moved, and the
       2px under the key read as a tighter gap there than at the top. */
    flex: 1 1 auto;
    box-shadow: none;
  }
  .editor.arranging :global([data-slot]) {
    outline: 1px dashed var(--hairline);
    outline-offset: -1px;
  }
  /* A key the profile does not draw leaves an empty handle behind; there is
     nothing to grab, so there is nothing to show. */
  .editor.arranging .arr:not(:has(*)) {
    display: none;
  }
  /* The bar sizes to its contents while things are being moved into it. */
  .editor.arranging .panel {
    max-height: 60dvh;
  }
  .editor.arranging .slot-empty {
    padding: 0 0.4rem;
    min-height: var(--key-h);
    display: inline-flex;
    align-items: center;
    color: var(--ink-2);
    font-size: 0.82rem;
  }
  /* A column with nothing in it still has to be a target one can hit. */
  .editor.arranging .left,
  .editor.arranging .right {
    min-width: 4rem;
  }
  /* The transport is one control: its keys keep the row's own spacing so
     nothing reads as a seam between them. */
  .transport-keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  /* The pipette's source pair, in a tool window of the same make as the
     zoom one (ScaleMenu). */
  .pick-window {
    padding: 0.5rem;
    border: none;
    border-radius: var(--r-md);
    background: var(--canvas);
    font-size: 0.8125rem;
  }
  .pick-title {
    margin: 0 0 0.4rem;
    font-weight: 600;
  }
  .pick-source {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .pick-source button {
    flex: 1;
    padding: 0 10px;
    font-size: 0.8125rem;
  }
  /* Undo/redo (and whatever else the config puts beside them) stay a row —
     the studio column turns this into a grid below. */
  .history {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .timeline {
    flex: 1;
    min-width: 0;
  }
  /* Phone: the toolbar is a wall between the drawing and the thumb, so it
     gives back every spare pixel it can — the stage keeps the rest. */
  @media (max-width: 40rem) {
    .panel {
      padding: 0.4rem 0.5rem;
      padding-bottom: max(0.4rem, env(safe-area-inset-bottom));
    }
    .toolbar {
      gap: 0.35rem;
    }
    .row {
      gap: 0.3rem;
    }
    /* The timeline's scroll arrows are a mouse affordance: a phone swipes the
       strip and Tab walks the frames, so they give their 88px back to the
       thumbnails. Both classes, to outrank the shared .key vocabulary below. */
    .editor :global(.arrow.key) {
      display: none;
    }
  }
  /* ---- Studio layout (toonio.ru editor.html) ----
     tools | canvas | panels, the bar under all three. The bar keeps its own
     rows; only the draw row moves out to the sides. */
  .editor.studio {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: minmax(0, 1fr) auto;
    background: var(--paper);
  }
  /* Every area names its row as well as its column: grid auto-placement never
     goes backwards, so under `.alt` — where .left sits right of .right — an
     unpinned row would push each following area onto a new one. */
  .studio .stage {
    grid-column: 2;
    grid-row: 1;
    /* A 1fr track still refuses to go under its content's min width, and the
       canvas is as wide as the drawing: without this the side columns get
       squeezed, or pushed off the screen, instead of the canvas re-fitting. */
    min-width: 0;
  }
  .studio .panel {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  /* A column holds whatever the config puts in it, so it is a grid of keys:
     loose keys pair up across the width the column was dragged to, and the
     groups (tools, history, the palette and brush boxes) take a row each. */
  .studio .left,
  .studio .right {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(var(--key-h), 100%), 1fr));
    align-content: start;
    background: var(--paper);
    gap: 0.6rem;
    min-height: 0;
    padding: 1rem 0.9rem;
    overflow-y: auto;
    box-sizing: border-box;
  }
  .studio .left > :global(*:not(.key):not(.arr)),
  .studio .right > :global(*:not(.key):not(.arr)),
  .studio .left > .arr.wide,
  .studio .right > .arr.wide {
    grid-column: 1 / -1;
  }
  .studio .left > :global(.key),
  .studio .right > :global(.key) {
    min-width: 0;
  }
  .studio .left {
    grid-column: 1;
    grid-row: 1;
    width: 8.4rem;
    border-right: 1px solid var(--hairline);
  }
  .studio .right {
    grid-column: 3;
    grid-row: 1;
    align-items: stretch;
    border-left: 1px solid var(--hairline);
    /* The palette box's own 225px plus the column padding: its floor is also
       its default, so the box is never squashed, only widened. */
    width: 15.9rem;
  }
  /* Dragging a column wider is meant to buy palette columns, not padding —
     and a box moved to the other column has to fit that one too. */
  .studio .left :global(.box),
  .studio .right :global(.box) {
    width: 100%;
  }
  /* The column's inner edge: the drag band and the fold handle, on a line the
     stage does not have to carry — it is drawn only under the cursor, where it
     says what the band does. A grid item, not a child of the column: the
     column scrolls, and would cut the handle in half. */
  .side-edge {
    grid-row: 1;
    align-self: stretch;
    position: relative;
    width: 1px;
    z-index: 4;
    background: transparent;
    /* Only the line's own controls take the pointer; the strip does not sit
       between the canvas and the cursor. */
    pointer-events: none;
  }
  .side-edge > * {
    pointer-events: auto;
  }
  .side-edge:hover {
    background: var(--hairline);
  }
  .side-edge.edge-left {
    grid-column: 1;
    justify-self: end;
  }
  .side-edge.edge-right {
    grid-column: 3;
    justify-self: start;
  }
  /* A 9px band straddling the seam, so the grab target is not a hairline. The
     seam itself is drawn only while that band is in use: a permanent rule down
     the stage is a seam the drawing does not need. */
  .side-resizer {
    position: absolute;
    inset: 0 -4px;
    cursor: ew-resize;
    touch-action: none;
  }
  /* A seam and a tab are drawn thin on purpose — wider, they stop being a
     seam and become furniture. The band that catches the pointer is separate
     from the line that is drawn, and reaches the 24px floor WCAG 2.2 AA asks
     for. Each one borders panel surface, not another control, so nothing else
     loses its own press to it. (Same move as the timeline's column splitter.) */
  .side-resizer::after,
  .resizer::after,
  .fold::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    min-width: 24px;
    min-height: 24px;
    width: 100%;
    height: 100%;
    transform: translate(-50%, -50%);
  }
  .side-resizer:hover,
  .side-edge.dragging .side-resizer {
    background: linear-gradient(var(--accent), var(--accent)) center / 2px 100% no-repeat;
  }
  /* Focus lands on the seam itself, so it is the seam that has to show it —
     an outline on a 1px box is a hairline halo nobody can see. */
  .side-resizer:focus-visible {
    outline: none;
    background: linear-gradient(var(--accent), var(--accent)) center / 3px 100% no-repeat;
  }
  /* The fold tab: the editor's own key — hairline, 7px radius, 2px of travel
     under the press — grown sideways out of the panel edge. Square where it
     meets the panel, rounded where it meets the stage. */
  .fold {
    position: absolute;
    /* Over the drag band it overlaps: the tab is a button, not a grab area. */
    z-index: 2;
    /* On the corner, level with the first key in the column — floating at
       half height it belongs to nothing. */
    top: 1rem;
    display: grid;
    place-items: center;
    /* 15, not 14: the tab is border-box and drops the border on the side it
       leans against, so a 14px lip leaves the 14px arrow 13px to sit in and
       the panel paints over the pixel that sticks out. */
    width: 15px;
    height: var(--key-h);
    padding: 0;
    border: none;
    background: var(--canvas);
    color: var(--text-2);
    cursor: pointer;
    transition:
      opacity 0.13s ease,
      background 0.15s ease;
  }
  /* The tab leans out over the stage, never over the panel's own contents. */
  .at-left .fold {
    left: 0;
    border-left: none;
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
  }
  .side-edge:not(.at-left) .fold {
    right: 0;
    border-right: none;
    border-radius: var(--r-sm) 0 0 var(--r-sm);
  }
  .fold:hover {
    background: var(--sub);
    color: var(--text);
  }
  .fold:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* Folded, the tab is all that is left of the column: it waits at the screen
     edge, quiet until the cursor comes for it — quiet being its fill, which it
     shares with the collapsed bar's tab above. Fading the tab itself took the
     `--edge` outline to 1.8:1 and the arrow with it. */
  /* Folded: the column is a bare strip at the screen edge, wide enough to
     carry the circle and nothing else. */
  .studio .left.collapsed,
  .studio .right.collapsed {
    width: 0.75rem;
    padding: 0;
    overflow: visible;
  }
  /* Reference «альтернативная раскладка» (`S:2321-2331`): the two side columns
     swap places. Classes only — the DOM order, and so the tab order, is
     untouched. Above the phone breakpoint, where there are columns to swap. */
  @media (min-width: 40.0625rem) {
    .studio.alt .left {
      grid-column: 3;
      border-right: none;
      border-left: 1px solid var(--hairline);
    }
    .studio.alt .right {
      grid-column: 1;
      border-left: none;
      border-right: 1px solid var(--hairline);
    }
    .studio.alt .side-edge.edge-left {
      grid-column: 3;
      justify-self: start;
    }
    .studio.alt .side-edge.edge-right {
      grid-column: 1;
      justify-self: end;
    }
  }
  /* In a column the keys fill whatever width it was dragged to: even columns
     when there is room, one when there is not. In a row they stay a row. */
  .studio .left .history,
  .studio .right .history {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(var(--key-h), 100%), 1fr));
    gap: 0.5rem;
  }
  .studio .history :global(.key) {
    min-width: 0;
  }
  .fps-inline {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.4rem;
  }
  .fps-inline input[type='range'] {
    width: 6rem;
    margin: 0;
      /* 16px is the native height of a range and too thin to catch; the track
       stays where it is drawn, the band around it is a finger deep — and a
       finger is the floor DESIGN §5 sets for everything outside the montage
       grid, not the 24 the standard settles for. */
    height: var(--key-h, 2.75rem);
}
  .fps-inline input[type='number'] {
    width: 3.2rem;
    height: var(--key-h);
    box-sizing: border-box;
    padding: 0 0.3rem;
    border: 1px solid var(--edge);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  /* Phone: no room for side columns — they stack above and below the canvas
     and lay their contents out in a row. */
  @media (max-width: 40rem) {
    .editor.studio {
      display: flex;
    }
    .studio .left,
    .studio .right {
      display: flex;
      flex-direction: row;
      width: auto !important;
      padding: 0.4rem 0.5rem;
      gap: 0.4rem;
      /* A rail takes a slice of the screen it cannot exceed and scrolls what
         does not fit inside itself. Holding its content height was how the
         canvas ended up with nothing: `.right` alone measured 379px of 676. */
      flex: 0 1 auto;
      min-height: 0;
      overflow: auto;
      overscroll-behavior: contain;
      /* And it says that it scrolls. On 390px the left rail carries ten keys
         and shows six; the tenth is «Опубликовать», the only way out of the
         editor into the product, and a cleanly cut key is a signal only to
         someone who already knows the rail moves. When nothing overflows the
         fade lies over paper and is invisible. */
      mask-image: linear-gradient(to right, #000 calc(100% - 1.25rem), transparent);
      /* A key Tab scrolls into view stops short of the fade, ring and all. */
      scroll-padding-inline: 1.25rem;
    }
    .studio .left {
      max-height: 26dvh;
      /* The rail of loose keys is the one that runs past the screen. Its end
         padding is the fade's width: scrolled to its end, the last key
         («Опубликовать» on the site) stands clear of it. */
      padding-right: 1.25rem;
    }
    /* Inside a rail the history is one more run of keys in the rail's row,
       with none of the rail's own scrolling around it. Named as the column
       rule names it: `.studio .left .history` is three classes, and a phone
       rule of two lost to it whatever the media query — the history stayed a
       16px grid, «Отменить» under «Полный экран», «Вернуть» in a band of its
       own that took the height from the canvas. */
    .studio .left .history,
    .studio .right .history {
      display: flex;
      flex: none;
      gap: 0.4rem;
    }
    .studio .right {
      max-height: 22dvh;
    }
    /* A key is 44 wide or it is not a key (DESIGN §5). The desktop columns
       drop that floor so loose keys fill the width they were dragged to; here
       there is no width to fill, and nine keys split 360px into 17px slivers —
       under the 24px WCAG 2.2 AA asks for, and closer together (6.4px) than the
       spacing exception forgives. The rail scrolls sideways instead. */
    .studio .left > :global(.key),
    .studio .right > :global(.key),
    .studio .history :global(.key) {
      flex: none;
      min-width: var(--key-h);
    }
    .side-edge {
      display: none;
    }
    .studio .right :global(.box) {
      flex: 1;
      min-width: 0;
      width: auto;
    }
    .studio .right :global(.palette .grid) {
      max-height: 64px;
    }
    /* The box stays: fps lives nowhere else, and without it a mult drawn on a
       phone played at the rate it was born with. The slider is the part a
       390px row has no room for. */
    .fps-inline input[type='range'],
    .studio .ends {
      display: none;
    }
    /* A height dragged out on a desktop must not swallow the canvas here: the
       phone sizes the panel to its contents instead, the timeline to its rows,
       and the divider that sets that height goes away with them. */
    .studio .panel {
      height: auto !important;
      padding-top: 0.4rem;
      flex: 0 1 auto;
      min-height: 0;
      max-height: 26dvh;
      /* The third rail, and it scrolls like the other two. `clip` plus the 20px
         margin is a desktop arrangement: the margin is there so the fold tab
         and the resizer can paint outside, and both are `display: none` below.
         What it did here instead was hand the *document* a scrollbar — the
         column fits 788 exactly, the panel wanted 177 of its 167, and the
         missing ten painted past the studio: 855 against a 844 viewport. */
      overflow: auto;
      overflow-clip-margin: 0;
      overscroll-behavior: contain;
    }
    /* The floor the canvas never gives up. It is the last child to be sized
       and the only one that grows, so without a floor it takes whatever the
       others leave — which, when they leave nothing, is nothing: `.stage`
       measured 0 on a phone and the drawing painted outside it, over the
       toolbar. There was nowhere to draw. */
    .studio .stage {
      flex: 1 1 auto;
      min-height: 38dvh;
    }
    .resizer,
    .fold {
      display: none;
    }
    .studio .toolbar,
    .studio .row:has(.timeline),
    .studio .timeline {
      flex: none;
      height: auto;
    }
    /* `flex: none` alone sizes the strip to every frame in it — 772px in a
       374px row — and its own scroller never scrolls. */
    .studio .timeline {
      width: 100%;
    }
    .studio .timeline :global(.board) {
      height: auto;
      max-height: 40dvh;
    }
    /* Transport and output do not fit one 390px line — they wrap instead of
       pushing the page into a horizontal scroll. Every layout, not just the
       studio: a row that overflows widens the whole layout viewport, and the
       fixed sheets (drafts, settings) then hang their right edge — the delete
       key of a draft row — off the screen. */
    .row {
      flex-wrap: wrap;
    }
  }

  /* A phone turned on its side is not a narrow screen — it is a short one, and
     `max-width` never hears about it. At 844×390 the studio keeps its grid,
     where the canvas row is `1fr` and takes whatever the bar leaves:
     `panelFloor` stops that at 151px, so nothing collapses to nothing the way
     portrait did, but the bar can be dragged to three quarters of 390 and
     leave the canvas under a hundred pixels with nothing to stop at. A `1fr`
     row does not grow for a child's `min-height` — the child overflows it
     instead — so the floor is written on the row, and the bar's ceiling comes
     down to where that floor is reachable. */
  @media (max-height: 30rem) {
    .editor.studio {
      grid-template-rows: minmax(38dvh, 1fr) auto;
    }
    .studio .panel {
      max-height: 55dvh;
    }
    /* 334px under the site bar hold the canvas's 38dvh and a bar of one key
       row plus the strip — not a transport wrapped to two lines, which pushed
       the page 15px past the screen. Here the row scrolls sideways like the
       phone rail and says so with the same fade; the bleed keeps the keys'
       travel and focus rings inside the scroll box. */
    .studio .row:not(:has(.timeline)) {
      flex-wrap: nowrap;
      overflow-x: auto;
      overscroll-behavior: contain;
      padding: var(--bleed);
      margin: calc(-1 * var(--bleed));
      mask-image: linear-gradient(to right, #000 calc(100% - 1.25rem), transparent);
      scroll-padding-inline: 1.25rem;
    }
    .studio .row:not(:has(.timeline)) > :global(*) {
      flex: none;
    }
  }
  /* Zoom group: two keys around a tabular readout, so the width does not
     jump as the percentage changes. */
  /* Import failure: an alert over the canvas, dismissed by the user — an
     error about their file must not vanish before it is read. */
  /* Centred by margins, not `left: 50%` + a shift: an absolute box shrinks to
     the room right of its `left`, so the reason wrapped at half the stage and
     ran under the zoom bar. Above the tool windows, whose rung it shared. */
  .import-error {
    position: absolute;
    inset-inline: 0;
    bottom: 1rem;
    z-index: var(--z-float);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: max-content;
    max-width: min(32rem, 92%);
    margin: 0 auto;
    padding: 0.5rem 0.75rem;
    /* DESIGN §5 answers a refusal with the weight of the line, not a colour:
       red belongs to «рисовать» and the Signal Rule names borders and errors
       among the places it may not go. The reason is carried by the words, in
       a `role="alert"` the reader already gets. */
    border: 2px solid var(--ink);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font-size: 0.85rem;
  }
  .layers {
    position: relative;
  }

  /* ---- Sheet chrome ----
     Global, because the sheets are not all in this file any more: the settings
     sheet is its own component and wears the same head / body / hint / foot /
     toggle vocabulary. */
  /* The update lock: a plain card in the middle, nothing to press on it. */
  .updating {
    margin: auto;
    padding: 1rem 1.4rem;
    border: none;
    border-radius: var(--r-md);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-weight: 650;
  }
  .updating::backdrop {
    background: var(--scrim);
  }
  /* The shape comes from the shared `.sheet` chrome; a <dialog> only needs its
     own defaults cleared and a backdrop of its own (as in the settings sheet). */
  .editor :global(.sheet-dialog) {
    margin: 0;
    padding: 0;
    max-width: none;
    border: none;
    color: var(--ink);
  }
  /* The whole line is the target, a finger tall (DESIGN §5). */
  .mute-warning {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--key-h, 2.75rem);
    cursor: pointer;
  }
  .editor :global(.sheet-dialog)::backdrop {
    background: var(--scrim);
  }
  /* Bottom sheet on mobile, centered card on wider screens. */
  .editor :global(.sheet) {
    position: fixed;
    z-index: var(--z-sheet);
    left: 0;
    right: 0;
    /* A modal <dialog> brings `inset-block: 0` from the browser's sheet, and
       with both edges pinned and the height its content's, `top` wins: the
       sheet hung from the top of the phone, out of the thumb's reach. */
    top: auto;
    bottom: 0;
    /* A <dialog> is `width: fit-content` by the browser's sheet, so pinning
       both edges was not enough: the sheet grew to its widest line and took
       its close key off a 320px screen. */
    width: auto;
    display: flex;
    flex-direction: column;
    max-height: 85dvh;
    background: var(--canvas);
    border-top-left-radius: var(--r-md);
    border-top-right-radius: var(--r-md);
    box-shadow: var(--shadow-sheet);
  }
  @media (min-width: 40.0625rem) {
    .editor :global(.sheet) {
      left: 50%;
      right: auto;
      bottom: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      /* Fixed: `100%` is the initial containing block, scrollbar excluded. */
      width: min(24rem, calc(100% - 2rem));
      border-radius: var(--r-md);
      /* Not a sheet any more: all four corners, all four sides, floating over
         the scrim. The sheet's lift points up because it rises from an edge —
         centred, that leaves it standing on nothing. */
      box-shadow: var(--shadow-plate);
    }
  }
  .editor :global(.sheet-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.9rem 1rem 0.6rem;
    border-bottom: 1px solid var(--hairline);
  }
  .editor :global(.sheet-head h2) {
    /* At 200 % text on a phone the title and the close key share 256px: the
       title breaks rather than running under the key. */
    min-width: 0;
    overflow-wrap: anywhere;
    /* …and where it must break a word, at a syllable with a hyphen, not
       «Настрой / ки». */
    hyphens: auto;
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
  }
  .editor :global(.sheet-body) {
    /* A flex child's min-height is its content unless told otherwise, which
       would push the footer out of a full sheet instead of scrolling. */
    min-height: 0;
    overflow-y: auto;
    padding: 0.4rem 1rem 0.6rem;
    /* A file name, an address or a long word at 200 % text breaks inside the
       sheet instead of widening it. */
    overflow-wrap: anywhere;
  }
  /* The sheet clips its sides: the ring goes inside the body it marks. */
  .editor :global(.sheet-body:focus-visible) {
    outline-offset: -3px;
  }
  .editor :global(.sheet-hint) {
    margin: 0.7rem 0 0.4rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .keylist {
    margin: 0;
    display: grid;
    gap: 0.1rem;
  }
  .keyrow {
    display: grid;
    grid-template-columns: 4.6rem 1fr; /* fits the widest chip, «← / →» */
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.32rem 0;
  }
  .keyrow dt,
  .keyrow dd {
    margin: 0;
  }
  .keylist kbd {
    display: inline-block;
    min-width: 1.9rem;
    padding: 0.15rem 0.45rem;
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--ink);
  }
  .keylist dd {
    font-size: 0.9rem;
    color: var(--ink-2);
  }
  .editor :global(.toggle) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2.9rem;
    padding: 0 0.3rem;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .editor :global(.toggle:hover) {
    background: var(--sub);
  }
  .editor :global(.toggle + .toggle) {
    border-top: 1px solid var(--hairline-soft);
  }
  .editor :global(.toggle-label) {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.95rem;
  }
  /* One row per draft: preview, when it was saved, how big it is, delete. */
  .drafts {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* The keys stand shoulder to shoulder: on a phone-width sheet the gaps
     between them were the room the date needed. */
  /* Where the date and the keys do not share a line (320px, 200 % text) the
     keys go under it, to the right, instead of pushing the sheet wider. */
  .draft {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0;
  }
  .draft-keys {
    display: flex;
  }
  .draft + .draft {
    border-top: 1px solid var(--hairline-soft);
  }
  .draft-open {
    display: flex;
    /* Its content as the basis: the date keeps its line, and the keys are
       what moves down when the two do not fit. */
    flex: 1 1 auto;
    align-items: center;
    gap: 0.75rem;
    min-height: 3.4rem;
    padding: 0.4rem 0.3rem;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .draft-open:hover {
    background: var(--sub);
  }
  .draft-thumb {
    display: flex;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    overflow: hidden;
  }
  .draft-meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .draft-date {
    font-size: 0.95rem;
  }
  .draft-size {
    font-size: 0.8rem;
    color: var(--ink-2);
  }
  .empty {
    margin: 1.2rem 0;
    color: var(--ink-2);
  }
  .editor :global(.sheet-foot) {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.7rem 1rem;
    padding-bottom: max(0.7rem, env(safe-area-inset-bottom));
    border-top: 1px solid var(--hairline);
  }

  /* ---- Shared button vocabulary (global so child components inherit it) ---- */
  /* Key: a flat white pill on the panel's paper (web-look «Студия в том же
     виде»), known by its fill and its icon like the site's buttons — a control
     with a visible label needs no 3:1 edge (WCAG 1.4.11 Understanding). The
     press is felt as a squeeze, not a hard key under it. */
  .editor :global(.key) {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-width: var(--key-h);
    height: var(--key-h);
    padding: 0 0.7rem;
    border: none;
    border-radius: var(--r-pill);
    background: var(--canvas);
    color: var(--text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 0.13s cubic-bezier(0.2, 0.8, 0.2, 1),
      background 0.15s ease,
      color 0.15s ease;
  }
  /* Reference `.control p`: hovering a key with a shortcut swaps its icon for
     the key itself. Drawn over the icon, so no button reflows on hover; the
     same letter is in the title and the aria-label for everyone else. */
  .editor :global(.key[data-key]:hover:not(:disabled))::after {
    content: attr(data-key);
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: inherit;
    background: inherit;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  @media (hover: none) {
    /* A touch "hover" sticks after a tap — the letter would cover the icon. */
    .editor :global(.key[data-key]:hover:not(:disabled))::after {
      content: none;
    }
  }
  .editor :global(.saved:empty) {
    padding: 0;
  }
  .editor :global(.saved) {
    padding: 0 0.4rem;
    font-size: 0.78rem;
    color: var(--ink-2);
    white-space: nowrap;
  }
  .editor :global(.key.icon) {
    padding: 0;
  }
  .editor :global(.key:hover:not(:disabled)) {
    background: var(--sub);
  }
  .editor :global(.key:active:not(:disabled)) {
    transform: scale(0.96);
  }
  .editor :global(.key:focus-visible) {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .editor :global(.key:disabled) {
    opacity: 0.4;
    cursor: default;
  }
  /* Picked: a light wash of the accent under a red icon. */
  .editor :global(.key.active) {
    background: color-mix(in srgb, var(--accent) 14%, var(--canvas));
    color: var(--accent-ink);
  }
  .editor :global(.key.active:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--accent) 22%, var(--canvas));
  }
  /* Primary key: the one positive "ship" action — the red fill, white icon
     (4.76:1), a step darker under the cursor like the site's red button. */
  .editor :global(.key.primary) {
    padding: 0 1rem;
    background: var(--accent);
    color: var(--canvas);
  }
  /* On a sheet the page is white too, so a white key read as a bare word
     («Скачать палитры», «GIF»): there it takes the ghost fill (DESIGN.md). */
  .editor :global(.sheet .key:not(.primary):not(.active)) {
    background: var(--sub);
  }
  .editor :global(.sheet .key:not(.primary):not(.active):hover:not(:disabled)) {
    background: color-mix(in oklab, var(--sub), var(--text) 8%);
  }
  /* An icon is form enough: the ghost fill is for word keys, and three ghost
     circles shoulder to shoulder in a draft row stood rim to rim. At rest the
     key is bare; under the cursor its circle is drawn in the content box, 4px
     in from each side, so it never touches a neighbour. The target stays 44.
     Global and after the ghost rules: Svelte scopes every class past the
     first with `:where()`, and a scoped rule weighed less than the fill. */
  .editor :global(.sheet .draft .key.icon:not(.active)) {
    padding: 4px;
    background: none;
    background-clip: content-box;
  }
  /* The hover above writes the `background` shorthand, which resets the clip. */
  .editor :global(.sheet .draft .key.icon:hover:not(:disabled)) {
    background-clip: content-box;
  }
  .editor :global(.key.primary.icon) {
    padding: 0;
  }
  .editor :global(.key.primary:hover:not(:disabled)) {
    background: var(--accent-ink);
  }

  /* Reduced motion keeps the pressed tone, not the squeeze. */
  @media (prefers-reduced-motion: reduce) {
    .editor :global(.key) {
      transition: background 0.15s ease, color 0.15s ease;
    }
    .editor :global(.key:active:not(:disabled)) {
      transform: none;
    }
  }
</style>
