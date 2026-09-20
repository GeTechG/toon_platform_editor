<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { EditorState } from './editor-state.svelte';
  import CanvasView from './CanvasView.svelte';
  import BrushPanel from './BrushPanel.svelte';
  import ColorPanel from './ColorPanel.svelte';
  import ToolKey from './ToolKey.svelte';
  import FloatWindow from './FloatWindow.svelte';
  import PanelArranger from './PanelArranger.svelte';
  import TransformMenu from './TransformMenu.svelte';
  import ScaleMenu from './ScaleMenu.svelte';
  import ExportSheet from './ExportSheet.svelte';
  import LayersPanel from './LayersPanel.svelte';
  import AudioPanel from './AudioPanel.svelte';
  import Timeline from './Timeline.svelte';
  import PlayControls from './PlayControls.svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import Icon from './Icon.svelte';
  import { decodeLegacyJson, decodeToon } from '../format/toon-decode';
  import { loadDocument } from '../format/validate';
  import { isEmptyDocument } from '../model/operations';
  import { draftSizeClass, formatFileSize } from './file-size';
  import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './viewport';
  import { wrapIndex } from './frame-selection';
  import { draftEntries } from '../draft/restore';
  import {
    deleteAllDrafts,
    deleteDraft,
    duplicateDraft,
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
  import { PANEL_HEIGHT_AUDIO, PANEL_HEIGHT_MIN, SIDE_WIDTH_MAX, SIDE_WIDTH_MIN } from './presets';
  import { panelItem as panelItemSpec, toolOfItem } from './panels';
  import type { SideId } from './presets';
  import type { DraftEntry } from '../draft/restore';
  import type { ToonDocument } from '../format/types';

  // Optional publish hook. When a host app provides it, a Publish button appears
  // and hands the host a plain snapshot of the current document; the editor
  // itself stays unaware of what publishing means (no network, no platform
  // coupling).
  // The soundtrack travels beside the document, not inside it: the toon format
  // holds drawings, and the platform stores the file on its own endpoint.
  let {
    onPublish,
  }: { onPublish?: (doc: ToonDocument, audio?: AudioTrackData | null) => void } = $props();

  const editor = new EditorState();
  // Studio layout (toonio.ru): tools down the left, palette and brush boxes
  // on the right, the timeline and transport under the canvas.
  const studio = $derived(editor.ux.layout === 'studio');
  // The session being autosaved. Minted when the editor opens and kept for as
  // long as this sheet lives, so a visit overwrites its own record instead of
  // piling up a new draft per stroke (reference `autosave_worker.js:14-22`); a
  // draft opened from the list continues under its own id, and opening a file
  // starts a fresh one. Nothing is written until something is drawn.
  let draftId = newDraftId();

  // Root element, so F can request fullscreen on the whole editor.
  let editorEl: HTMLDivElement;
  let layersOpen = $state(false);
  let audioOpen = $state(false);
  // Components the keyboard drives: Space is play/stop, Alt+S the export.
  let playControls = $state<PlayControls | undefined>();
  let exportButton = $state<ExportSheet | undefined>();

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
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'toonop-errors.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Last three typed characters, for the reference's "old" easter egg
  // (Main.hx keyDown: charCodes 111,108,100 toggle the oldschool pen).
  const lastThreeKeys = ['', '', ''];

  // --- Bottom panel divider ------------------------------------------------
  // The studio bar is resizable from its top edge, and the timeline is the row
  // that grows with it — dragging down gives the grid more layers and frames.
  let viewportHeight = $state(0);
  let viewportWidth = $state(0);
  /**
   * The floor grows with a soundtrack: the strip and the wave lane are part of
   * the timeline, so a panel sitting at its minimum has to make room for them
   * rather than push the layer rows out of view.
   */
  const panelFloor = $derived(PANEL_HEIGHT_MIN + (editor.audio.hasTrack ? PANEL_HEIGHT_AUDIO : 0));
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
  function moveOrExtend(shift: boolean, frame: number, layer: number): void {
    if (shift && studio) {
      editor.selectCell(frame, layer, 'range');
      return;
    }
    editor.selectFrame(frame);
    editor.selectLayer(layer);
  }

  /**
   * Keys the reference still acts on while a form field has focus: apply,
   * play and cancel. Everything else belongs to the field being typed in.
   */
  const TYPING_KEYS = ['Enter', ' ', 'Escape'];

  // Editor hotkeys, matching the reference editors: bare single keys, ignored
  // while typing in a form field or when a browser/OS modifier is held.
  function onKeydown(e: KeyboardEvent): void {
    // Alt+E is the reference's mega-eraser; every other modifier is the
    // browser's or the OS's.
    if (e.altKey && (e.key === 'e' || e.key === 'E') && studio) {
      e.preventDefault();
      editor.selectTool('mega-eraser');
      return;
    }
    // Reference Ctrl+S / Alt+S / Alt+Enter. These fire from a form field too:
    // the browser would otherwise take Ctrl+S for "save page", and muting the
    // warnings is not a keystroke anyone types by accident.
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveNow();
      return;
    }
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      // Reference Alt+S in Toonio saves the project to a file; the other
      // presets have no project file, so there it stays the export.
      if (studio) {
        saveProjectFile();
      } else {
        exportButton?.start();
      }
      return;
    }
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      editor.warnings = !editor.warnings;
      return;
    }
    // Reference Alt+L: the session's errors as a file, for a bug report.
    if (e.altKey && (e.key === 'l' || e.key === 'L')) {
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
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
    if (typing && !TYPING_KEYS.includes(e.key)) {
      return;
    }
    // The hand takes the zoom and the arrows before frames and brush size do
    // — the reference's `helpTool.ArrowMove || PrevFrame` order.
    if (editor.tool === 'drag' && !editor.transform) {
      const step = e.shiftKey ? 30 : 10;
      let taken = true;
      switch (e.key) {
        case '+':
        case '=':
          editor.zoomBy(ZOOM_STEP);
          break;
        case '-':
        case '_':
          editor.zoomBy(-ZOOM_STEP);
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
      switch (e.key) {
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

    lastThreeKeys.shift();
    lastThreeKeys.push(e.key);
    if (lastThreeKeys.join('') === 'old') {
      editor.toggleOldschool();
    }

    let handled = true;
    switch (e.key) {
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
      // The studio clipboard is the timeline selection (cells × layers); the
      // bar has no selection, so there C/V stay whole-frame copy and paste.
      case 'c':
      case 'C':
        studio ? editor.copySelection() : editor.copyActiveFrame();
        break;
      case 'v':
      case 'V':
        studio ? editor.pasteSelection() : editor.pasteFrame();
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
      // Reference M merges the buffer into the selected cells. The bar keeps
      // Multator's meaning — M is the only way to its full color picker.
      case 'm':
      case 'M':
        studio ? editor.mergeSelection() : editor.togglePalette();
        break;
      // The reference's F is the feather; ours is fullscreen. The studio
      // takes the reference's meaning, fullscreen stays on the button.
      case 'f':
      case 'F':
        if (studio) {
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
          if (editor.doc.layers.length > 1 && (!editor.layerHasStrokes(editor.activeLayer) || askDelete('Удалить слой со штрихами?'))) {
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
        moveOrExtend(e.shiftKey, editor.activeFrame === 0 ? lastFrame : editor.activeFrame - 1, editor.activeLayer);
        break;
      case 'ArrowRight':
        moveOrExtend(e.shiftKey, editor.activeFrame >= lastFrame ? 0 : editor.activeFrame + 1, editor.activeLayer);
        break;
      case 'ArrowUp':
        moveOrExtend(e.shiftKey, editor.activeFrame, wrapIndex(editor.activeLayer + 1, editor.doc.layers.length));
        break;
      case 'ArrowDown':
        moveOrExtend(e.shiftKey, editor.activeFrame, wrapIndex(editor.activeLayer - 1, editor.doc.layers.length));
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
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
    }
  }

  /** Something has changed since the last write. The autosave clock clears it. */
  let dirty = $state(false);

  // Track the change signals (fps, frame count, per-frame stroke count —
  // strokes are append-only). Skipping the untouched document also avoids
  // clobbering a draft before restore runs.
  $effect(() => {
    if (!editor.touched) {
      return;
    }
    const doc = editor.doc;
    void doc.frame_rate;
    void doc.layers.length;
    for (const layer of doc.layers) {
      void layer.hidden;
      void layer.frames.length;
      for (const cell of layer.frames) {
        void cell.strokes.length;
      }
    }
    dirty = true;
  });

  /** A write into working storage failed: stop trying and say so, once. */
  let saveFailed = $state(false);
  /** The clock came round during playback; the write waits for the stop. */
  let queued = false;
  /** Size of the record as last written — what the indicator reports. */
  let savedBytes = $state(0);

  /** Writes the draft right now — the autosave clock, Ctrl+S and the sheet. */
  function saveNow(): void {
    if (!editor.touched || saveFailed) {
      return;
    }
    const doc = $state.snapshot(editor.doc);
    queued = false;
    dirty = false;
    editor.lastSavedAt = Date.now();
    // What the record will weigh: the document plus the track riding with it.
    savedBytes = JSON.stringify(doc).length + (editor.audio.blob?.size ?? 0);
    void saveDraft(draftId, doc, editor.sessionState()).then((ok) => {
      if (ok) {
        writeScreenshot(doc);
        return;
      }
      saveFailed = true;
      alert('Ошибка локального сохранения. Скачайте проект и перезагрузите страницу.');
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
    if (editor.warnings && !confirm('Скачать проект в формате .toonop?')) {
      return;
    }
    const blob = new Blob([JSON.stringify($state.snapshot(editor.doc))], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'toonop.toonop';
    link.click();
    URL.revokeObjectURL(url);
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

  async function removeAllDrafts(): Promise<void> {
    if (!askDelete('Удалить все черновики? Отменить это будет нельзя.')) {
      return;
    }
    await deleteAllDrafts();
    draftId = newDraftId();
    await refreshDrafts();
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
      if (!confirm('Открыть черновик? Текущий рисунок будет заменён.')) {
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
    if (!askDelete('Удалить черновик? Отменить это будет нельзя.')) {
      return;
    }
    await deleteDraft(entry.id);
    if (draftId === entry.id) {
      draftId = newDraftId();
    }
    await refreshDrafts();
  }

  /** Reference Alt+Enter: with the warnings muted a delete just happens. */
  /**
   * Reference warning on the first mega-eraser of the session: the tool
   * rewrites the strokes of a cell in place, so the draft written right after
   * it is the way back.
   */
  const MEGA_ERASER_WARNING =
    'Мега-ластик — экспериментальный инструмент: он режет уже нарисованные штрихи. '
    + 'Черновик сохранён на всякий случай.';

  $effect(() => {
    if (editor.tool !== 'mega-eraser' || editor.megaEraserWarned) {
      return;
    }
    editor.megaEraserWarned = true;
    if (editor.warnings) {
      alert(MEGA_ERASER_WARNING);
    }
    saveNow();
  });

  function askDelete(message: string): boolean {
    return !editor.warnings || confirm(message);
  }

  const PLURAL = new Intl.PluralRules('ru');
  function plural(n: number, one: string, few: string, many: string): string {
    const form = PLURAL.select(n);
    return `${n} ${form === 'one' ? one : form === 'few' ? few : many}`;
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
      if (!confirm(`Открыть «${file.name}»? Текущий рисунок будет заменён.`)) {
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
          importError = `Не удалось открыть файл: ${result.error}`;
          return;
        }
        doc = result.doc;
      } else if (name.endsWith('.toon')) {
        const result = decodeToon(await file.arrayBuffer());
        if (!result.ok) {
          importError = `Не удалось открыть файл: ${result.error}`;
          return;
        }
        doc = result.doc;
        original = result.original;
      } else {
        importError = 'Кажется, такой формат файла не поддерживается';
        return;
      }
    } catch (err) {
      importError = `Не удалось открыть файл: ${err instanceof Error ? err.message : err}`;
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
      importError = 'Кажется, такой формат файла не поддерживается';
    }
  }
  // The reference's settings window: drawing, palette, autosave, view.
  let settingsSheetOpen = $state(false);

  function openSettingsSheet(): void {
    leaveFullscreen();
    settingsSheetOpen = true;
  }

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
  // here, the sheet lies — keep them next to each other for that reason.
  const SHORTCUTS: [string, string][] = $derived([
    ['B', 'Карандаш'],
    ['E', 'Ластик'],
    ['P', 'Пипетка'],
    ['+ / −', 'Толще / тоньше кисть'],
    ['M', 'Показать палитру (Toonio: объединить)'],
    ['Z', 'Отменить штрих'],
    ['Y', 'Вернуть штрих'],
    ['C', 'Скопировать кадр (Toonio: выделение)'],
    ['V', 'Вставить кадр (Toonio: выделение)'],
    ['F', 'Во весь экран (Toonio: перо)'],
    ['A', 'Добавить кадр (Shift — слой)'],
    ['Del', 'Удалить кадр (Shift — слой)'],
    ['J / L', 'Первый / последний кадр'],
    ['← / →', 'Предыдущий / следующий кадр'],
    ['↑ / ↓', 'Слой выше / ниже'],
    ['Shift + ←→↑↓', 'Toonio: расширить выделение ленты'],
    ['K', 'Калька'],
    ['X', 'Поменять контур и заливку'],
    ['Space', 'Просмотр (в трансформации — применить)'],
    ['Ctrl + S', 'Сохранить черновик сейчас'],
    ['Alt + S', studio ? 'Скачать проект (.toonop)' : 'Экспорт'],
    ['Alt + Enter', 'Отключить предупреждения об удалении'],
    ['Alt + L', 'Скачать лог ошибок'],
  ]);

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
  accept=".toonop,.toon,.json"
  class="file"
  aria-label="Открыть файл проекта"
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
    title="Отменить последний штрих (Z)"
    aria-label="Отменить"
  >
    <Icon name="undo" />
  </button>
  <button
    class="key"
    disabled={!editor.canRedo}
    onclick={() => editor.redo()}
    data-key="Y"
    title="Вернуть отменённый штрих (Y)"
    aria-label="Вернуть"
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
        aria-label="Ширина панели: {label}"
        aria-valuenow={sideWidth(id)}
        aria-valuemin={SIDE_WIDTH_MIN[id]}
        aria-valuemax={SIDE_WIDTH_MAX}
        tabindex="0"
        onpointerdown={(e) => onSideDown(e, id)}
        onkeydown={(e) => onSideKey(e, id)}
        title="Ширина панели (← / →)"
      ></div>
    {/if}
    <!-- The arrow points the way the panel is about to travel. -->
    <button
      class="fold"
      onclick={() => editor.toggleSide(id)}
      aria-expanded={!folded(id)}
      title={folded(id) ? 'Развернуть панель' : 'Свернуть панель'}
      aria-label="{folded(id) ? 'Развернуть' : 'Свернуть'} панель: {label}"
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
  {:else if id === 'pick-source'}
    <!-- Reference: while the pipette is up, where it reads from. -->
    {#if editor.tool === 'pipette'}
      <div class="pick-source" role="group" aria-label="Источник пипетки">
        {#each [['canvas', 'Холст'], ['layer', 'Слой']] as [source, label] (source)}
          <button
            class="key"
            class:active={editor.pickSource === source}
            aria-pressed={editor.pickSource === source}
            onclick={() => editor.setPickSource(source as 'canvas' | 'layer')}
            title={source === 'canvas'
              ? 'Брать цвет с видимого холста (Alt — только активный слой)'
              : 'Брать цвет только с активного слоя'}
          >{label}</button>
        {/each}
      </div>
    {/if}
  {:else if id === 'save'}
    <!-- Reference «Сохранить»: the draft goes to disk now rather than on the
         next turn of the autosave clock. Nothing to write, nothing to press. -->
    <button
      class="key icon"
      onclick={saveNow}
      disabled={!dirty}
      data-key="Ctrl+S"
      title="Сохранить черновик сейчас (Ctrl+S)"
      aria-label="Сохранить черновик"
    >
      <Icon name="save" />
    </button>
  {:else if id === 'history'}
    <div class="history">
      {@render history()}
    </div>
  {:else if id === 'manual'}
    <!-- Reference «Мануал» (`E:61-63`): the keys, with no key of its own. -->
    <button class="key icon" onclick={() => (manualOpen = true)} title="Мануал" aria-label="Мануал">
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
        title="Полный экран (F)"
        aria-label="Полный экран"
      >
        <Icon name="expand" />
      </button>
    {/if}
  {:else if id === 'drafts'}
    <button class="key icon" onclick={openDrafts} title="Локальные сохранения" aria-label="Локальные сохранения">
      <Icon name="drafts" />
    </button>
  {:else if id === 'palette'}
    <ColorPanel {editor} />
  {:else if id === 'brush'}
    <BrushPanel {editor} />
  {:else if id === 'timeline'}
    <div class="timeline">
      <Timeline {editor} />
    </div>
  {:else if id === 'transport'}
    <!-- One control: ⏮ ⏴ ▶ ⏵ ⏭ travel together, the way a transport reads.
         The bar layout has no step keys (the reference gives it play alone). -->
    <div class="transport-keys" role="group" aria-label="Управление воспроизведением">
      {#if studio}
        <button
          class="key icon ends"
          disabled={editor.playing || editor.activeFrame === 0}
          onclick={() => editor.selectFrame(0)}
          title="На первый кадр"
          aria-label="На первый кадр"
        >⏮</button>
        <button
          class="key icon"
          disabled={editor.playing}
          onclick={() => editor.selectFrame(wrapIndex(editor.activeFrame - 1, lastFrame + 1))}
          title="Предыдущий кадр"
          aria-label="Предыдущий кадр"
        >⏴</button>
      {/if}
      <PlayControls bind:this={playControls} {editor} />
      {#if studio}
        <button
          class="key icon"
          disabled={editor.playing}
          onclick={() => editor.selectFrame(wrapIndex(editor.activeFrame + 1, lastFrame + 1))}
          title="Следующий кадр"
          aria-label="Следующий кадр"
        >⏵</button>
        <button
          class="key icon ends"
          disabled={editor.playing || editor.activeFrame >= lastFrame}
          onclick={() => editor.selectFrame(lastFrame)}
          title="На последний кадр"
          aria-label="На последний кадр"
        >⏭</button>
      {/if}
    </div>
  {:else if id === 'add-frame'}
    <button
      class="key"
      disabled={editor.playing}
      onclick={onAddFrame}
      data-key="A"
      title="Добавить кадр после текущего (A; Ctrl+клик — перед)"
      aria-label="Добавить кадр"
    >
      <Icon name="plus" />
    </button>
  {:else if id === 'delete-frame'}
    <button
      class="key"
      disabled={editor.playing}
      onclick={() => editor.removeActiveFrame()}
      data-key="Del"
      title="Удалить текущий кадр (Del)"
      aria-label="Удалить кадр"
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
      title={editor.onionSkin ? 'Калька (K) включена' : 'Калька (K) выключена'}
      aria-label="Калька"
    >
      <Icon name="onion" />
    </button>
  {:else if id === 'fps'}
    <!-- The reference keeps fps on the bar itself: a slider and a box. -->
    <label class="fps-inline" title="Частота кадров">
      <span class="sr-only">Частота кадров</span>
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
      />
    </label>
  {:else if id === 'zoom'}
    <!-- Zoom: the wheel and pinch do this too, but a keyboard user needs
         a control, and the readout says where we are. -->
    <div class="zoom" role="group" aria-label="Масштаб холста">
      <button
        class="key"
        disabled={editor.view.zoom <= ZOOM_MIN}
        onclick={() => editor.zoomBy(-ZOOM_STEP)}
        title="Уменьшить масштаб"
        aria-label="Уменьшить масштаб"
      >−</button>
      <button
        class="key zoom-value"
        disabled={editor.view.zoom === ZOOM_MIN && editor.view.panX === 0 && editor.view.panY === 0}
        onclick={() => editor.resetView()}
        title="Вернуть 100%"
        aria-label="Масштаб {Math.round(editor.view.zoom * 100)} процентов, вернуть 100%"
      >{Math.round(editor.view.zoom * 100)}%</button>
      <button
        class="key"
        disabled={editor.view.zoom >= ZOOM_MAX}
        onclick={() => editor.zoomBy(ZOOM_STEP)}
        title="Увеличить масштаб"
        aria-label="Увеличить масштаб"
      >+</button>
    </div>
  {:else if id === 'layers'}
    <!-- The studio timeline carries the layer list inline, so the popup
         is the bar layout's form of it. -->
    <div class="layers">
      <button
        class="key"
        class:active={layersOpen}
        aria-expanded={layersOpen}
        aria-haspopup="dialog"
        onclick={() => (layersOpen = !layersOpen)}
        title="Слои"
        aria-label="Слои"
      >
        <Icon name="layers" />
      </button>
      {#if layersOpen}
        <LayersPanel {editor} onClose={() => (layersOpen = false)} />
      {/if}
    </div>
  {:else if id === 'audio'}
    <!-- The soundtrack lives behind its own key, beside layers and export:
         the wave belongs on the timeline, the file and its credits do not. -->
    <div class="layers">
      <button
        class="key"
        class:active={audioOpen}
        aria-expanded={audioOpen}
        aria-haspopup="dialog"
        onclick={() => (audioOpen = !audioOpen)}
        title={editor.audio.hasTrack ? `Звук: ${editor.audio.name || 'без названия'}` : 'Звук'}
        aria-label="Звук"
      >
        <Icon name="note" />
      </button>
      {#if audioOpen}
        <AudioPanel {editor} onClose={() => (audioOpen = false)} />
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
    {#if saveFailed}
      <span class="saved too_big" role="status">
        <Icon name="x" size={14} /> Ошибка локального сохранения
      </span>
    {:else if lastSaved}
      <span class="saved {draftSizeClass(savedBytes)}" role="status">
        сохранено локально {lastSaved} · {formatFileSize(savedBytes)}
      </span>
    {/if}
  {:else if id === 'copy'}
    <button
      class="key icon"
      disabled={editor.playing}
      onclick={() => editor.copySelection()}
      data-key="C"
      title="Копировать выделенные ячейки (C)"
      aria-label="Копировать выделение"
    ><Icon name="copy" /></button>
  {:else if id === 'paste'}
    <button
      class="key icon"
      disabled={!editor.canPasteCells}
      onclick={() => editor.pasteSelection()}
      data-key="V"
      title="Вставить с заменой ячеек (V)"
      aria-label="Вставить выделение"
    ><Icon name="paste" /></button>
  {:else if id === 'settings'}
    <!-- Movable, never hideable: this key is the way back to the settings. -->
    <button
      class="key icon"
      aria-haspopup="dialog"
      onclick={openSettingsSheet}
      title="Настройки"
      aria-label="Настройки"
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
        title="Опубликовать"
        aria-label="Опубликовать"
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
      title="Объединить: штрихи буфера поверх ячеек (M)"
      aria-label="Объединить кадры"
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
        title="Перетащи «{panelItemSpec(id)?.label ?? id}»"
      >
        {@render panelItem(id)}
      </div>
    {:else}
      {@render panelItem(id)}
    {/if}
  {/each}
  {#if editor.arranging && items.length === 0}
    <span class="slot-empty">пусто</span>
  {/if}
{/snippet}


<div
  class="editor"
  class:studio
  class:alt={editor.settings.altLayout}
  class:arranging={editor.arranging}
  data-float-root
  bind:this={editorEl}
>
  {#if studio && (editor.panels.left.length > 0 || editor.arranging)}
    <aside
      class="left"
      class:collapsed={folded('left')}
      aria-label="Инструменты и история"
      data-slot="left"
      style={sideStyle('left')}
      bind:clientWidth={sidePx.left}
    >
      {#if !folded('left')}
        {@render slot(editor.panels.left)}
      {/if}
    </aside>
    {@render sideEdge('left', 'Инструменты и история')}
  {/if}
  <div class="stage" data-slot="float">
    <CanvasView {editor} />
    <!-- The reference's two floating tool windows: the transform fields while
         a selection is live, the zoom window while the hand is up. They sit
         over the canvas, not in the tool rail, which is only 8.4rem wide. -->
    {#if editor.transform || editor.scaleMenuVisible}
      <div class="tool-windows">
        {#if editor.transform}
          <TransformMenu {editor} />
        {/if}
        {#if editor.scaleMenuVisible}
          <ScaleMenu {editor} />
        {/if}
      </div>
    {/if}
    {#if flashVisible}
      <div class="flash" aria-hidden="true"></div>
    {/if}
    {#if importError}
      <p class="import-error" role="alert">
        {importError}
        <button class="key" onclick={() => (importError = '')} aria-label="Закрыть сообщение">
          <Icon name="x" size={16} />
        </button>
      </p>
    {/if}
  </div>
  {#if studio && (editor.panels.right.length > 0 || editor.arranging)}
    <aside
      class="right"
      class:collapsed={folded('right')}
      aria-label="Палитра и кисть"
      data-slot="right"
      style={sideStyle('right')}
      bind:clientWidth={sidePx.right}
    >
      {#if !folded('right')}
        {@render slot(editor.panels.right)}
      {/if}
    </aside>
    {@render sideEdge('right', 'Палитра и кисть')}
  {/if}
  <div
    class="panel"
    class:collapsed={panelFolded}
    class:dragging={resize?.side === 'panel'}
    style={studio && !panelFolded && !editor.arranging ? `height: ${panelHeight}px` : undefined}
  >
    {#if studio}
      <!-- The bar folds like the columns do: the same key-shaped tab, lying on
           its side at the corner of its seam. -->
      <button
        class="fold lying"
        onclick={() => editor.togglePanel()}
        aria-expanded={!panelFolded}
        title={panelFolded ? 'Развернуть панель' : 'Свернуть панель'}
        aria-label="{panelFolded ? 'Развернуть' : 'Свернуть'} нижнюю панель"
      >
        <Icon name={panelFolded ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
    {/if}
    {#if studio && !panelFolded}
      <!-- A focusable separator is a window splitter widget (ARIA 1.2), which
           svelte-check's non-interactive rules do not model. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="resizer"
        role="separator"
        aria-label="Высота нижней панели"
        aria-orientation="horizontal"
        aria-valuenow={panelHeight}
        aria-valuemin={panelFloor}
        tabindex="0"
        onpointerdown={(e) =>
          startResize(e, 'y', -1, panelHeight, (px) => editor.setPanelHeight(px), 'panel')}
        onkeydown={onDividerKey}
        title="Высота нижней панели (↑ / ↓)"
      ></div>
    {/if}
    {#if !panelFolded}
      <!-- However many rows the arrangement has, top to bottom. A row that
           empties is gone (panels.ts), so no unreachable strip is left; a new
           row is made by dragging past a row's top or bottom edge, so nothing
           has to stand there holding a place open. -->
      <div class="toolbar">
        {#each editor.panels.rows as row, i (i)}
          <div class="row" role="group" aria-label="Строка {i + 1}" data-slot="row:{i}">
            {@render slot(row)}
          </div>
        {/each}
      </div>
    {/if}
  </div>

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

  <!-- Drafts sheet: every local save with its first frame, newest first. -->
  {#if draftsOpen}
    <div
      class="sheet-backdrop"
      role="button"
      tabindex="-1"
      aria-label="Закрыть черновики"
      onclick={() => (draftsOpen = false)}
      onkeydown={(e) => e.key === 'Escape' && (draftsOpen = false)}
    ></div>
    <div class="sheet" role="dialog" aria-label="Черновики" aria-modal="true">
      <header class="sheet-head">
        <h2>Черновики</h2>
        <button class="key icon" onclick={() => (draftsOpen = false)} aria-label="Закрыть">
          <Icon name="x" />
        </button>
      </header>

      <div class="sheet-body">
        {#if drafts.length === 0}
          <p class="empty">Сохранённых черновиков пока нет — рисуй, они появятся сами.</p>
        {:else}
          <p class="sheet-hint">
            {plural(drafts.length, 'черновик', 'черновика', 'черновиков')} на этом устройстве
            {#if storageUsed}· занято {formatFileSize(storageUsed)}{/if}
          </p>
          <ul class="drafts">
            {#each drafts as entry (entry.id)}
              <li class="draft">
                <button class="draft-open" onclick={() => openDraft(entry)}>
                  <span class="draft-thumb">
                    {#if thumbUrls[entry.id]}
                      <!-- The still written with the record: no document to
                           re-render, and it is what the drawing looked like. -->
                      <img src={thumbUrls[entry.id]} alt="" height="44" />
                    {:else}
                      <FrameThumb doc={entry.doc} frameIndex={0} maxW={44} />
                    {/if}
                  </span>
                  <span class="draft-meta">
                    <span class="draft-date">{new Date(entry.updated).toLocaleString('ru')}</span>
                    <span class="draft-size">
                      {plural(entry.doc.layers[0].frames.length, 'кадр', 'кадра', 'кадров')} ·
                      {plural(entry.doc.layers.length, 'слой', 'слоя', 'слоёв')}
                      {#if entry.bytes}
                        · <span class={draftSizeClass(entry.bytes)}>{formatFileSize(entry.bytes)}</span>
                      {/if}
                    </span>
                    {#if entry.audio}
                      <span class="draft-track">
                        <Icon name="note" size={13} />
                        {entry.audio.author ? `${entry.audio.author} — ` : ''}{entry.audio.name || 'без названия'}
                      </span>
                    {/if}
                  </span>
                </button>
                <button
                  class="key icon"
                  onclick={() => copyDraft(entry)}
                  title="Сделать копию черновика"
                  aria-label="Копия черновика"
                >
                  <Icon name="copy" />
                </button>
                <button
                  class="key icon"
                  onclick={() => removeDraft(entry)}
                  title="Удалить черновик"
                  aria-label="Удалить черновик"
                >
                  <Icon name="trash" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <footer class="sheet-foot">
        {#if drafts.length > 0}
          <button class="key" onclick={removeAllDrafts}>Удалить все</button>
        {/if}
        <button class="key primary" onclick={() => (draftsOpen = false)}>Закрыть</button>
      </footer>
    </div>
  {/if}

  {#if settingsSheetOpen}
    <SettingsSheet
      {editor}
      onClose={() => (settingsSheetOpen = false)}
      onSaveNow={saveNow}
      onOpenFile={() => fileInput?.click()}
      onOpenDrafts={openDrafts}
    />
  {/if}

  <!-- Customization sheet: roomy, one concern per row, big tap targets. -->
  <!-- (SHORTCUTS is declared in the script block above.) -->
  {#if manualOpen}
    <div
      class="sheet-backdrop"
      role="button"
      tabindex="-1"
      aria-label="Закрыть мануал"
      onclick={() => (manualOpen = false)}
      onkeydown={(e) => e.key === 'Escape' && (manualOpen = false)}
    ></div>
    <div class="sheet" role="dialog" aria-label="Мануал" aria-modal="true">
      <header class="sheet-head">
        <h2>Мануал</h2>
        <button class="key icon" onclick={() => (manualOpen = false)} aria-label="Закрыть">
          <Icon name="x" />
        </button>
      </header>

      <div class="sheet-body">
        <!-- Every shortcut the key handler above actually implements, in one
             place. They were reachable but undocumented: nothing in the UI said
             the editor had any. Behind the sheet, so the toolbar stays quiet. -->
        <p class="sheet-hint">Горячие клавиши</p>
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
        <button class="key primary" onclick={() => (manualOpen = false)}>Готово</button>
      </footer>
    </div>
  {/if}
</div>

<style>
  /* toonop tokens (DESIGN.md): ink / paper / canvas / electric / signal.
     Defined on the root so every child component inherits them through the
     DOM — scoped styles still resolve `var(--…)` at runtime. */
  .editor {
    --ink: #0b0c10;
    --ink-2: #333a48;
    --paper: #eaeef7;
    /* The worktable: one tonal step under the chrome, same blue bias. Four
       surfaces read apart without a single extra line — panels on paper, the
       drawing on white, the table between them. */
    --table: #d7dfee;
    --canvas: #ffffff;
    --sky: #e4f1fb;
    --electric: #1b5cff;
    --electric-dark: #134bd6;
    --signal: #ff4326;
    --signal-dark: #d8331c; /* the working red: what gets read, 4.76:1 */
    --signal-deep: #b02a15;
    --hairline: #0b0c1024;
    --hairline-soft: #0b0c1012;
    --ghost-2: #1b5cff1a;
    /* Layer tags: six hues cycling by row position, a display aid only — the
       document stores no colour. Kept muted so a column of them reads as
       stripes beside the names rather than competing with the drawing. */
    --layer-tag-0: #1b5cff;
    --layer-tag-1: #00997a;
    --layer-tag-2: #b8860b;
    --layer-tag-3: #c0392b;
    --layer-tag-4: #7d3cc7;
    --layer-tag-5: #0f7d9e;
    --r-sm: 7px;
    --r-md: 14px;
    /* WCAG/DESIGN tap floor — every key is at least 44x44. */
    --key-h: 2.75rem;

    /* Frame for the floating windows: they live over the whole editor, not
       over the canvas, so folding a column does not move them. */
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
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
  /* Paper worktable so the white canvas floats on brand tone, not a bare
     letterbox. Padding keeps the canvas off the bars. */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--table);
    padding: clamp(0.5rem, 2.2vw, 1.25rem);
    box-sizing: border-box;
  }
  .tool-windows {
    position: absolute;
    left: clamp(0.5rem, 2.2vw, 1.25rem);
    top: clamp(0.5rem, 2.2vw, 1.25rem);
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 13rem;
    max-height: calc(100% - 2 * clamp(0.5rem, 2.2vw, 1.25rem));
    overflow-y: auto;
    /* Lifted off the paper the way a window is, not painted onto it. */
    filter: drop-shadow(0 10px 24px rgba(15, 23, 60, 0.18));
  }
  /* On a phone the stage is short — a floating window would cover the drawing,
     so the windows sit under the canvas and span the width. */
  @media (max-width: 40rem) {
    .tool-windows {
      position: static;
      width: auto;
      max-height: none;
      margin-top: 0.5rem;
      filter: none;
    }
  }
  /* Copy/paste flash — the reference's 0xCCCCCC @ 0.9 fadeSprite. */
  .flash {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: rgba(204, 204, 204, 0.9);
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
    min-height: 0;
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
    background: linear-gradient(var(--electric), var(--electric)) center / 100% 2px no-repeat;
  }
  .resizer:focus-visible {
    outline: none;
    background: linear-gradient(var(--electric), var(--electric)) center / 100% 3px no-repeat;
  }
  /* The bar's own tab: the side tab turned on its side, at the corner of the
     seam where the tools column ends. */
  .fold.lying {
    top: auto;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    width: var(--key-h);
    height: 14px;
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
  .panel.collapsed .fold {
    opacity: 0.55;
  }
  .panel.collapsed .fold:hover,
  .panel.collapsed .fold:focus-visible {
    opacity: 1;
  }
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
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
    border-radius: var(--r-sm);
    outline: 2px dashed var(--electric);
    outline-offset: -2px;
    cursor: grab;
    touch-action: none;
  }
  .editor.arranging .arr > :global(*) {
    pointer-events: none;
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
    max-height: 60vh;
    overflow-y: auto;
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
  /* The pipette's source pair, under the key that opened it. */
  .pick-source {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .pick-source button {
    padding: 0 10px;
    font-size: 13px;
  }
  .studio .pick-source {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(var(--key-h), 100%), 1fr));
    gap: 0.5rem;
  }
  .studio .pick-source button {
    min-width: 0;
    padding: 0 4px;
    font-size: 12px;
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
  .side-resizer:hover,
  .side-edge.dragging .side-resizer {
    background: linear-gradient(var(--electric), var(--electric)) center / 2px 100% no-repeat;
  }
  /* Focus lands on the seam itself, so it is the seam that has to show it —
     an outline on a 1px box is a hairline halo nobody can see. */
  .side-resizer:focus-visible {
    outline: none;
    background: linear-gradient(var(--electric), var(--electric)) center / 3px 100% no-repeat;
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
    width: 14px;
    height: var(--key-h);
    padding: 0;
    border: 1px solid var(--hairline);
    background: var(--canvas);
    color: var(--ink-2);
    box-shadow: 0 2px 0 var(--hairline);
    cursor: pointer;
    transition:
      transform 0.13s cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 0.13s cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 0.13s ease,
      background 0.15s ease,
      border-color 0.15s ease;
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
    background: var(--sky);
    border-color: var(--electric);
    color: var(--ink);
    box-shadow: 0 1px 0 var(--hairline);
  }
  .fold:hover {
    transform: translateY(1px);
  }
  .fold:active {
    box-shadow: 0 0 0 var(--hairline);
    transform: translateY(2px);
  }
  .fold:focus-visible {
    outline: 3px solid var(--electric, #2f5bff);
    outline-offset: 2px;
  }
  /* Folded, the tab is all that is left of the column: it waits at the screen
     edge, quiet until the cursor comes for it. */
  .side-edge.folded .fold {
    opacity: 0.55;
  }
  .side-edge.folded .fold:hover,
  .side-edge.folded .fold:focus-visible {
    opacity: 1;
  }
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
  /* The keys fill whatever width the column was dragged to: even columns when
     there is room, one column when there is not, and narrower keys under that. */
  .studio .history {
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
    accent-color: var(--electric);
  }
  .fps-inline input[type='number'] {
    width: 3.2rem;
    height: var(--key-h);
    box-sizing: border-box;
    padding: 0 0.3rem;
    border: 1px solid var(--hairline);
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
    .studio .right,
    .studio .history {
      display: flex;
      flex-direction: row;
      width: auto !important;
      padding: 0.4rem 0.5rem;
      gap: 0.4rem;
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
    .fps-inline,
    .studio .ends {
      display: none;
    }
    /* A height dragged out on a desktop must not swallow the canvas here: the
       phone sizes the panel to its contents instead, the timeline to its rows,
       and the divider that sets that height goes away with them. */
    .studio .panel {
      height: auto !important;
      padding-top: 0.4rem;
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
    .studio .timeline :global(.studio) {
      height: auto;
      max-height: 40vh;
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
  /* Zoom group: two keys around a tabular readout, so the width does not
     jump as the percentage changes. */
  /* Import failure: an alert over the canvas, dismissed by the user — an
     error about their file must not vanish before it is read. */
  .import-error {
    position: absolute;
    left: 50%;
    bottom: 1rem;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: min(32rem, 92%);
    margin: 0;
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--signal);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font-size: 0.85rem;
  }
  .file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .zoom-value {
    min-width: 3.4rem;
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
  }
  .layers {
    position: relative;
  }

  /* ---- Sheet chrome ----
     Global, because the sheets are not all in this file any more: the settings
     sheet is its own component and wears the same head / body / hint / foot /
     toggle vocabulary. */
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    border: none;
    background: rgba(11, 12, 16, 0.42);
  }
  /* Bottom sheet on mobile, centered card on wider screens. */
  .editor :global(.sheet) {
    position: fixed;
    z-index: 11;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    max-height: 85dvh;
    background: var(--canvas);
    border-top-left-radius: var(--r-md);
    border-top-right-radius: var(--r-md);
    box-shadow: 0 -12px 32px -12px rgba(15, 23, 60, 0.4);
  }
  @media (min-width: 40rem) {
    .editor :global(.sheet) {
      left: 50%;
      right: auto;
      bottom: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(24rem, calc(100vw - 2rem));
      border-radius: var(--r-md);
    }
  }
  .editor :global(.sheet-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1rem 0.6rem;
    border-bottom: 1px solid var(--hairline);
  }
  .editor :global(.sheet-head h2) {
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
    background: var(--sky);
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
  /* Bigger, brand-colored checkboxes — comfortable touch targets. */
  .editor :global(.toggle input) {
    width: 1.3rem;
    height: 1.3rem;
    accent-color: var(--electric);
    cursor: pointer;
  }
  /* One row per draft: preview, when it was saved, how big it is, delete. */
  .drafts {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .draft {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .draft + .draft {
    border-top: 1px solid var(--hairline-soft);
  }
  .draft-open {
    display: flex;
    flex: 1;
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
    background: var(--sky);
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
  /* Ghost key: quiet toolbar action on canvas, 1px hairline, physical press.
     DESIGN §4 (The Physical-Key Rule) — a flat key with no travel is banned;
     the action has to be felt. In a dense toolbar the offset is 2px rather
     than the page's 5px, so the rule holds without the bar reading as a wall
     of protruding blocks. box-shadow takes no layout space, so the rows keep
     their heights. */
  .editor :global(.key) {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-width: var(--key-h);
    height: var(--key-h);
    padding: 0 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-weight: 650;
    cursor: pointer;
    box-shadow: 0 2px 0 var(--hairline);
    transition:
      transform 0.13s cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 0.13s cubic-bezier(0.2, 0.8, 0.2, 1),
      background 0.15s ease,
      border-color 0.15s ease;
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
    background: var(--sky);
    border-color: var(--electric);
    transform: translateY(1px);
    box-shadow: 0 1px 0 var(--hairline);
  }
  .editor :global(.key:active:not(:disabled)) {
    transform: translateY(2px);
    box-shadow: 0 0 0 var(--hairline);
  }
  .editor :global(.key:focus-visible) {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  .editor :global(.key:disabled) {
    opacity: 0.4;
    cursor: default;
    box-shadow: 0 2px 0 var(--hairline);
  }
  .editor :global(.key.active) {
    background: color-mix(in srgb, var(--electric) 10%, var(--canvas));
    border-color: var(--electric);
    color: var(--electric);
    box-shadow: 0 2px 0 var(--electric-dark);
  }
  .editor :global(.key.active:hover:not(:disabled)) {
    box-shadow: 0 1px 0 var(--electric-dark);
  }
  .editor :global(.key.active:active:not(:disabled)) {
    box-shadow: 0 0 0 var(--electric-dark);
  }
  /* Primary key: the one positive "ship" action — electric physical key. It
     keeps the shared footprint and is set apart by the electric fill and a
     deeper key travel than its neighbours. */
  .editor :global(.key.primary) {
    padding: 0 0.9rem;
    border-color: transparent;
    background: var(--electric);
    color: var(--canvas);
    box-shadow: 0 4px 0 var(--electric-dark);
  }
  .editor :global(.key.primary.icon) {
    padding: 0;
  }
  .editor :global(.key.primary:hover:not(:disabled)) {
    background: var(--electric);
    border-color: transparent;
    transform: translateY(2px);
    box-shadow: 0 2px 0 var(--electric-dark);
  }
  .editor :global(.key.primary:active:not(:disabled)) {
    transform: translateY(4px);
    box-shadow: 0 0 0 var(--electric-dark);
  }
  .editor :global(.key.primary:disabled) {
    box-shadow: 0 4px 0 var(--electric-dark);
  }

  /* Reduced motion keeps the key's depth and its pressed state — only the
     animated travel goes, so the button still reads as pressed. */
  @media (prefers-reduced-motion: reduce) {
    .editor :global(.key) {
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .editor :global(.key:hover:not(:disabled)),
    .editor :global(.key:active:not(:disabled)),
    .editor :global(.key.primary:hover:not(:disabled)),
    .editor :global(.key.primary:active:not(:disabled)) {
      transform: none;
    }
  }
</style>
