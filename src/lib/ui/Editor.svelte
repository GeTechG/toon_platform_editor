<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { EditorState } from './editor-state.svelte';
  import CanvasView from './CanvasView.svelte';
  import BrushPanel from './BrushPanel.svelte';
  import ToolsPanel from './ToolsPanel.svelte';
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
  import { PANEL_HEIGHT_AUDIO, PANEL_HEIGHT_MIN } from './presets';
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
  let resize: { pointerId: number; startY: number; startHeight: number } | null = null;

  function onDividerDown(e: PointerEvent): void {
    if (!e.isPrimary) return;
    resize = { pointerId: e.pointerId, startY: e.clientY, startHeight: panelHeight };
  }

  function onDividerMove(e: PointerEvent): void {
    if (!resize || e.pointerId !== resize.pointerId) return;
    // The panel sits at the bottom, so dragging up makes it taller.
    editor.setPanelHeight(resize.startHeight + (resize.startY - e.clientY));
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

<div
  class="editor"
  class:studio
  class:alt={editor.settings.altLayout}
  bind:this={editorEl}
>
  {#if studio}
    <aside class="left" aria-label="Инструменты и история">
      <ToolsPanel {editor} onSave={saveNow} {dirty} />
      <div class="history">
        {@render history()}
        <!-- Reference «Мануал» (`E:61-63`): the keys, with no key of its own. -->
        <button class="key icon" onclick={() => (manualOpen = true)} title="Мануал" aria-label="Мануал">
          <Icon name="help" />
        </button>
        {#if document.fullscreenEnabled}
          <button
            class="key icon"
            class:active={isFullscreen}
            aria-pressed={isFullscreen}
            onclick={toggleFullscreen}
            title="Полный экран"
            aria-label="Полный экран"
          >
            <Icon name="expand" />
          </button>
        {/if}
        <button class="key icon" onclick={openDrafts} title="Локальные сохранения" aria-label="Локальные сохранения">
          <Icon name="drafts" />
        </button>
      </div>
    </aside>
  {/if}
  <div class="stage">
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
  {#if studio}
    <aside class="right" aria-label="Палитра и кисть">
      <BrushPanel {editor} />
    </aside>
  {/if}
  <div class="panel" style={studio ? `height: ${panelHeight}px` : undefined}>
    {#if studio}
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
        onpointerdown={onDividerDown}
        onkeydown={onDividerKey}
        title="Высота нижней панели (↑ / ↓)"
      ></div>
    {/if}
    <div class="toolbar">
      <!-- Row A — frames: taking a stroke back comes first, then add / delete
           anchoring the timeline strip. -->
      <div class="row frames" role="group" aria-label="Кадры">
        {#if !studio}
          {@render history()}
        {/if}
        {#if editor.features.addFrame && !studio}
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
        {/if}
        {#if editor.features.deleteFrame && !studio}
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
        {/if}
        {#if editor.features.timeline}
          <div class="timeline">
            <Timeline {editor} />
          </div>
        {/if}
      </div>

      <!-- Row B — transport & output: play at left like the reference,
           settings / export next to it, publish anchored right. -->
      <div class="row transport" role="group" aria-label="Просмотр и экспорт">
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
        {#if editor.features.play}
          <PlayControls bind:this={playControls} {editor} />
        {/if}
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
          <!-- The reference puts add/delete frame on the bar itself, right
               after the transport keys, not beside the strip. -->
          {#if editor.features.addFrame}
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
          {/if}
          {#if editor.features.deleteFrame}
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
          {/if}
        {/if}
        {#if editor.features.onionSkin}
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
        {/if}
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
        <!-- The studio timeline carries the layer list inline, so the popup
             is the bar layout's form of it. -->
        {#if editor.features.layers && !studio}
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
        {/if}
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
        {#if editor.features.export}
          <ExportSheet
            bind:this={exportButton}
            {editor}
            onOpen={() => {
              saveNow();
              leaveFullscreen();
            }}
          />
        {/if}
        {#if saveFailed}
          <span class="saved too_big" role="status">
            <Icon name="x" size={14} /> Ошибка локального сохранения
          </span>
        {:else if lastSaved}
          <span class="saved {draftSizeClass(savedBytes)}" role="status">
            сохранено локально {lastSaved} · {formatFileSize(savedBytes)}
          </span>
        {/if}
        <!-- The gear is never hideable, so the settings are always reachable. -->
        <button
          class="key icon"
          aria-haspopup="dialog"
          onclick={openSettingsSheet}
          title="Настройки"
          aria-label="Настройки"
        >
          <Icon name="gear" />
        </button>
        {#if !studio}
          <!-- The rail holds these under the studio layout; the bar has no rail. -->
          <button class="key icon" onclick={openDrafts} title="Локальные сохранения" aria-label="Локальные сохранения">
            <Icon name="drafts" />
          </button>
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
        {/if}
        {#if studio}
          <button
            class="key icon"
            disabled={editor.playing}
            onclick={() => editor.copySelection()}
            data-key="C"
            title="Копировать выделенные ячейки (C)"
            aria-label="Копировать выделение"
          ><Icon name="copy" /></button>
          <button
            class="key icon"
            disabled={!editor.canPasteCells}
            onclick={() => editor.pasteSelection()}
            data-key="V"
            title="Вставить с заменой ячеек (V)"
            aria-label="Вставить выделение"
          ><Icon name="paste" /></button>
          <button
            class="key icon"
            disabled={!editor.canPasteCells}
            onclick={() => editor.mergeSelection()}
            data-key="M"
            title="Объединить: штрихи буфера поверх ячеек (M)"
            aria-label="Объединить кадры"
          ><Icon name="merge" /></button>
        {/if}
        {#if onPublish}
          <!-- Publishing leaves the editor; it gets its own zone at the end of
               the row so it never reads as one more tool toggle. -->
          <div class="ship" role="group" aria-label="Публикация">
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
          </div>
        {/if}
      </div>

      <!-- Row C — drawing: tools · sizes · color. In the studio these live in
           the side columns instead. -->
      {#if !studio}
        <div class="row draw" role="group" aria-label="Кисть">
          <!-- The save key is the Toonio rail's; the other presets keep Ctrl+S. -->
          <ToolsPanel {editor} />
          <BrushPanel {editor} />
        </div>
      {/if}
    </div>
  </div>

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
                      <FrameThumb doc={entry.doc} frameIndex={0} height={44} />
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
    background: var(--paper);
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
    background:
      linear-gradient(var(--hairline), var(--hairline)) center / 3rem 2px no-repeat;
  }
  .resizer:focus-visible {
    outline: 2px solid var(--electric, #2f5bff);
    outline-offset: -2px;
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
  .studio .row.frames {
    flex: 1;
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
  }
  .timeline {
    flex: 1;
    min-width: 0;
  }
  /* Publish leaves the editor, so it sits in its own zone at the end of the
     row — pushed away from the tool toggles and fenced off by a hairline. */
  .ship {
    display: flex;
    margin-left: auto;
    padding-left: 0.75rem;
    border-left: 1px solid var(--hairline);
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
    .ship {
      padding-left: 0.45rem;
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
  }
  .studio .panel {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .studio .left,
  .studio .right {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 0;
    padding: 1rem 0.9rem;
    overflow-y: auto;
    box-sizing: border-box;
  }
  .studio .left {
    grid-column: 1;
    grid-row: 1;
    width: 8.4rem;
  }
  .studio .right {
    grid-column: 3;
    grid-row: 1;
    align-items: stretch;
  }
  /* Reference «альтернативная раскладка» (`S:2321-2331`): the two side columns
     swap places. Classes only — the DOM order, and so the tab order, is
     untouched. Above the phone breakpoint, where there are columns to swap. */
  @media (min-width: 40.0625rem) {
    .studio.alt .left {
      grid-column: 3;
    }
    .studio.alt .right {
      grid-column: 1;
    }
  }
  .studio .history {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  /* The studio timeline is a tall grid, so the frame buttons beside it sit at
     its top rather than floating in the middle of it. */
  .studio .row.frames {
    align-items: flex-start;
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
      width: auto;
      padding: 0.4rem 0.5rem;
      gap: 0.4rem;
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
    .resizer {
      display: none;
    }
    .studio .toolbar,
    .studio .row.frames,
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
    .row.transport {
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
