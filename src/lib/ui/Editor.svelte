<script lang="ts">
  import { onMount } from 'svelte';
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
  import { decodeToon } from '../format/toon-decode';
  import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './viewport';
  import { draftEntries } from '../draft/restore';
  import { deleteDraft, listDrafts, newDraftId, saveDraft, setDraftAudio } from '../draft/store';
  import type { AudioTrackData } from '../audio/state.svelte';
  import FrameThumb from './FrameThumb.svelte';
  import { FEATURE_LABELS, FEATURE_ORDER, PANEL_HEIGHT_AUDIO, PANEL_HEIGHT_MIN, PRESETS } from './presets';
  import type { FeatureKey } from './presets';
  import type { DraftEntry } from '../draft/restore';
  import type { IconName } from './Icon.svelte';
  import type { ToonDocument } from '../format/types';

  // Icon per toggle where one maps cleanly — makes each row recognizable at a
  // glance; the rest fall back to their label alone.
  const FEATURE_ICONS: Partial<Record<FeatureKey, IconName>> = {
    addFrame: 'plus',
    deleteFrame: 'trash',
    play: 'play',
    export: 'download',
    tools: 'pencil',
    onionSkin: 'onion',
  };

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
  // The session being autosaved. Minted at the first edit and kept for as long
  // as this sheet lives, so a session overwrites its own record instead of
  // piling up a new draft per stroke; a draft opened from the list continues
  // under its own id.
  let draftId: string | null = null;

  // Root element, so F can request fullscreen on the whole editor.
  let editorEl: HTMLDivElement;
  let layersOpen = $state(false);
  let audioOpen = $state(false);
  // Components the keyboard drives: Space is play/stop, Alt+S the export.
  let playControls = $state<PlayControls | undefined>();
  let exportButton = $state<ExportSheet | undefined>();

  function toggleFullscreen(): void {
    if (!document.fullscreenEnabled) {
      return;
    }
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : editorEl.requestFullscreen();
    void request.catch(() => {});
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
      exportButton?.start();
      return;
    }
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      editor.warnings = !editor.warnings;
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) {
      return;
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
      // Reference Mirror: with nothing selected H flips the whole cell.
      case 'h':
        editor.mirrorActiveCell('horizontal');
        break;
      case 'H':
        editor.mirrorActiveCell('vertical');
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
      case 'a':
        editor.addFrameAfterActive();
        break;
      case 'A':
        editor.addLayerAboveActive();
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
        moveOrExtend(e.shiftKey, editor.activeFrame, Math.min(editor.activeLayer + 1, editor.doc.layers.length - 1));
        break;
      case 'ArrowDown':
        moveOrExtend(e.shiftKey, editor.activeFrame, Math.max(editor.activeLayer - 1, 0));
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
      // Reference Space: run and stop the preview.
      case ' ':
        playControls?.toggle();
        break;
      // Reference N: the dark theme.
      case 'n':
      case 'N':
        editor.toggleTheme();
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

  /** Writes the draft right now — the autosave clock, Ctrl+S and the sheet. */
  function saveNow(): void {
    if (!editor.touched) {
      return;
    }
    draftId ??= newDraftId();
    void saveDraft(draftId, $state.snapshot(editor.doc));
    dirty = false;
    editor.lastSavedAt = Date.now();
  }

  // The track rides the draft but not the document: it is written on its own
  // whenever the file or its credits change, so an autosave never carries a
  // 10 MB blob and attaching a track never waits for the autosave clock.
  $effect(() => {
    const { blob, name, author } = editor.audio;
    // An editor that was opened and not touched has no session to write to:
    // minting an id here would leave an empty record behind on every visit.
    if (!blob && draftId === null) {
      return;
    }
    draftId ??= newDraftId();
    void setDraftAudio(draftId, blob ? { blob, name, author } : null);
  });

  // Autosave on the reference's clock (AutoSave, every 60 s by default). A
  // trailing debounce was wrong here: with a minute-long interval a hand that
  // keeps drawing would reset it forever and never write anything.
  $effect(() => {
    const ms = editor.settings.autosaveMs;
    if (ms === 0) {
      return; // «никогда» — Ctrl+S is the only way to disk.
    }
    const timer = setInterval(() => {
      // The reference defers a write until playback is over.
      if (dirty && !editor.playing) {
        saveNow();
      }
    }, ms);
    return () => clearInterval(timer);
  });

  // Drafts saved on this device. The reference keeps every local save and
  // greets you with "Доступно локальное сохранение!" rather than loading the
  // last one behind your back (`toonio.bundle.js:233`) — so does this: the
  // editor opens on a clean sheet and offers the list when there is one.
  let draftsOpen = $state(false);
  let drafts = $state<DraftEntry[]>([]);

  async function refreshDrafts(): Promise<void> {
    drafts = draftEntries(await listDrafts());
  }

  onMount(async () => {
    await refreshDrafts();
    draftsOpen = drafts.length > 0 && editor.settings.showDraftsOnStart;
  });

  async function openDrafts(): Promise<void> {
    settingsOpen = false;
    await refreshDrafts();
    draftsOpen = true;
  }

  /** Loads a saved draft; the current drawing is replaced, so a touched one asks. */
  function openDraft(entry: DraftEntry): void {
    if (editor.touched && !confirm('Открыть черновик? Текущий рисунок будет заменён.')) {
      return;
    }
    editor.openDraft(entry.doc);
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
      draftId = null;
    }
    await refreshDrafts();
  }

  /** Reference Alt+Enter: with the warnings muted a delete just happens. */
  function askDelete(message: string): boolean {
    return !editor.warnings || confirm(message);
  }

  const PLURAL = new Intl.PluralRules('ru');
  function plural(n: number, one: string, few: string, many: string): string {
    const form = PLURAL.select(n);
    return `${n} ${form === 'one' ? one : form === 'few' ? few : many}`;
  }

  // Settings popover (opens above the ⚙ key): holds the everyday controls the
  // reference bar has no room for — onion skin, playback fps, fullscreen.
  let settingsOpen = $state(false);
  let fileInput = $state<HTMLInputElement | undefined>();
  /** Import failure, shown until the next attempt. */
  let importError = $state('');

  /**
   * Opens a Tonio `.toon` file. The current drawing is replaced, so a touched
   * document asks first — the draft it would overwrite is the user's work.
   */
  async function importToon(file: File): Promise<void> {
    importError = '';
    settingsOpen = false;
    if (editor.touched && !confirm(`Открыть «${file.name}»? Текущий рисунок будет заменён.`)) {
      return;
    }
    const result = decodeToon(await file.arrayBuffer());
    if (!result.ok) {
      importError = `Не удалось открыть файл: ${result.error}`;
      return;
    }
    editor.importDoc(result.doc);
  }
  // The reference's settings window: drawing, palette, autosave, view.
  let settingsSheetOpen = $state(false);

  function openSettingsSheet(): void {
    settingsOpen = false;
    settingsSheetOpen = true;
  }

  /** «Сохранено HH:MM» on the panel — the reference shows the last write. */
  const lastSaved = $derived(
    editor.lastSavedAt === null
      ? ''
      : new Date(editor.lastSavedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  );

  // Customization sheet: which buttons the toolbar shows, and the active preset.
  // A set-once concern, so it lives in its own roomy sheet, not the quick popover.
  let customizeOpen = $state(false);

  // Mirrors the key handler above one-for-one. If a case is added there and not
  // here, the sheet lies — keep them next to each other for that reason.
  const SHORTCUTS: [string, string][] = [
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
    ['Alt + S', 'Экспорт'],
    ['Alt + Enter', 'Отключить предупреждения об удалении'],
    ['N', 'Тёмная тема'],
  ];

  function openCustomize(): void {
    settingsOpen = false;
    customizeOpen = true;
  }

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
<svelte:window
  bind:innerHeight={viewportHeight}
  onkeydown={onKeydown}
  onpointermove={onDividerMove}
  onpointerup={onDividerUp}
  onpointercancel={onDividerUp}
  ondragover={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()}
  ondrop={(e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      e.preventDefault();
      void importToon(file);
    }
  }}
/>

<input
  bind:this={fileInput}
  type="file"
  accept=".toon"
  class="file"
  aria-label="Открыть файл .toon"
  onchange={(e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) {
      void importToon(file);
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
  class:dark={editor.settings.theme === 'dark'}
  class:grey-canvas={editor.settings.greyCanvas}
  bind:this={editorEl}
>
  {#if studio}
    <aside class="left" aria-label="Инструменты и история">
      <ToolsPanel {editor} />
      <div class="history">
        {@render history()}
        {#if document.fullscreenEnabled}
          <button class="key icon" onclick={toggleFullscreen} title="Полный экран" aria-label="Полный экран">
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
    {#if editor.transform || editor.tool === 'drag'}
      <div class="tool-windows">
        {#if editor.transform}
          <TransformMenu {editor} />
        {/if}
        {#if editor.tool === 'drag'}
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
            disabled={editor.playing || editor.activeFrame === 0}
            onclick={() => editor.selectFrame(editor.activeFrame - 1)}
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
            disabled={editor.playing || editor.activeFrame >= lastFrame}
            onclick={() => editor.selectFrame(editor.activeFrame + 1)}
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
        {#if studio}
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
        {/if}
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
          <ExportSheet bind:this={exportButton} {editor} />
        {/if}
        {#if lastSaved}
          <span class="saved" role="status">Сохранено {lastSaved}</span>
        {/if}
        <div class="settings">
          <button
            class="key icon"
            class:active={settingsOpen}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            onclick={() => (settingsOpen = !settingsOpen)}
            title="Настройки"
            aria-label="Настройки"
          >
            <Icon name="gear" />
          </button>
          {#if settingsOpen}
            <button class="backdrop" aria-label="Закрыть настройки" onclick={() => (settingsOpen = false)}></button>
            <div class="popover" role="dialog" aria-label="Настройки">
              <label class="opt">
                <span class="opt-label">Частота кадров</span>
                <span class="fps">
                  <input
                    type="number"
                    min={editor.ux.fpsRange[0]}
                    max={editor.ux.fpsRange[1]}
                    value={editor.doc.frame_rate}
                    onchange={onFpsChange}
                    disabled={editor.playing}
                  />
                  fps
                </span>
              </label>
              <button class="opt opt-btn" onclick={() => fileInput?.click()}>
                <span class="opt-label">Открыть .toon…</span>
              </button>
              <button class="opt opt-btn" onclick={openDrafts}>
                <span class="opt-label">Черновики…</span>
              </button>
              {#if document.fullscreenEnabled}
                <button class="opt opt-btn" onclick={toggleFullscreen}>
                  <span class="opt-label">На весь экран</span>
                  <kbd>F</kbd>
                </button>
              {/if}

              <!-- The gear is never hideable, so customization is always reachable. -->
              <hr class="divider" />
              <button class="opt opt-btn" onclick={openSettingsSheet}>
                <span class="opt-label"><Icon name="gear" size={18} /> Настройки…</span>
                <Icon name="chevron-right" size={16} />
              </button>
              <button class="opt opt-btn" onclick={openCustomize}>
                <span class="opt-label"><Icon name="gear" size={18} /> Настроить панель…</span>
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          {/if}
        </div>
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
                    ? { blob: editor.audio.blob, name: editor.audio.name, author: editor.audio.author }
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
          <p class="sheet-hint">Сохранены на этом устройстве</p>
          <ul class="drafts">
            {#each drafts as entry (entry.id)}
              <li class="draft">
                <button class="draft-open" onclick={() => openDraft(entry)}>
                  <span class="draft-thumb">
                    <FrameThumb doc={entry.doc} frameIndex={0} height={44} />
                  </span>
                  <span class="draft-meta">
                    <span class="draft-date">{new Date(entry.updated).toLocaleString('ru')}</span>
                    <span class="draft-size">
                      {plural(entry.doc.layers[0].frames.length, 'кадр', 'кадра', 'кадров')} ·
                      {plural(entry.doc.layers.length, 'слой', 'слоя', 'слоёв')}
                    </span>
                  </span>
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
        <button class="key primary" onclick={() => (draftsOpen = false)}>Закрыть</button>
      </footer>
    </div>
  {/if}

  {#if settingsSheetOpen}
    <SettingsSheet {editor} onClose={() => (settingsSheetOpen = false)} />
  {/if}

  <!-- Customization sheet: roomy, one concern per row, big tap targets. -->
  <!-- (SHORTCUTS is declared in the script block above.) -->
  {#if customizeOpen}
    <div
      class="sheet-backdrop"
      role="button"
      tabindex="-1"
      aria-label="Закрыть настройку панели"
      onclick={() => (customizeOpen = false)}
      onkeydown={(e) => e.key === 'Escape' && (customizeOpen = false)}
    ></div>
    <div class="sheet" role="dialog" aria-label="Настроить панель" aria-modal="true">
      <header class="sheet-head">
        <h2>Настроить панель</h2>
        <button class="key icon" onclick={() => (customizeOpen = false)} aria-label="Закрыть">
          <Icon name="x" />
        </button>
      </header>

      <div class="sheet-body">
        <p class="sheet-hint">Набор</p>
        <div class="presets" role="group" aria-label="Набор">
          {#each PRESETS as p (p.id)}
            <button
              class="preset-chip"
              class:active={editor.preset === p.id}
              aria-pressed={editor.preset === p.id}
              onclick={() => editor.applyPreset(p.id)}
            >
              {p.label}
            </button>
          {/each}
        </div>

        <p class="sheet-hint">Кнопки</p>
        <div class="toggles">
          {#each FEATURE_ORDER as key (key)}
            <label class="toggle">
              <span class="toggle-label">
                {#if FEATURE_ICONS[key]}<Icon name={FEATURE_ICONS[key]} size={18} />{/if}
                {FEATURE_LABELS[key]}
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={editor.features[key]}
                onchange={() => editor.toggleFeature(key)}
              />
            </label>
          {/each}
        </div>

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
        <button class="key" onclick={() => editor.resetFeatures()}>Сбросить к набору</button>
        <button class="key primary" onclick={() => (customizeOpen = false)}>Готово</button>
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
  /**
   * Dark theme (reference N key): window #19191A, worktable #262626, accent
   * #0D85F3. Only the chrome turns dark — the document's own background, the
   * frame thumbnails and the GIF export stay white, because the drawing is
   * white paper whatever the room looks like.
   *
   * Contrast against the surfaces here (WCAG 1.4.3 / 1.4.11): --ink 15.7:1,
   * --ink-2 8.9:1, --electric 5.9:1, and --canvas text on an --electric key
   * the same 5.9:1.
   */
  .editor.dark {
    --ink: #f2f4f8;
    --ink-2: #b3bac6;
    --paper: #262626;
    --canvas: #19191a;
    --sky: #24303f;
    --electric: #4d96ff;
    --electric-dark: #0d85f3;
    --signal: #ff6a52;
    --signal-dark: #ff8f7a;
    --signal-deep: #ffb3a3;
    --hairline: #ffffff2e;
    --hairline-soft: #ffffff17;
    --ghost-2: #4d96ff2e;
    color-scheme: dark;
  }
  /* Reference option: a grey worktable under the drawing instead of the
     near-black one. The white canvas on top is untouched. */
  .editor.dark.grey-canvas .stage {
    background: #616161;
  }
  /* The fields you do type in keep their selection. */
  .editor input {
    user-select: text;
    -webkit-user-select: text;
  }
  /* Paper worktable so the white canvas floats on brand tone, not a bare dark
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
  .settings {
    position: relative;
    display: flex;
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
  .studio .stage {
    grid-column: 2;
  }
  .studio .panel {
    grid-column: 1 / -1;
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
    width: 8.4rem;
  }
  .studio .right {
    grid-column: 3;
    align-items: stretch;
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
       pushing the page into a horizontal scroll. */
    .studio .row.transport {
      flex-wrap: wrap;
    }
  }
  /* Full-screen catcher so a click anywhere dismisses the popover. */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1;
    border: none;
    background: transparent;
    cursor: default;
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
  .popover {
    position: absolute;
    bottom: calc(100% + 0.4rem);
    right: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 13rem;
    padding: 0.4rem;
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    box-shadow: 0 12px 28px -12px rgba(15, 23, 60, 0.35);
  }
  .opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin: 0;
    padding: 0.45rem 0.55rem;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    font: inherit;
    font-size: 0.9rem;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  .opt:hover {
    background: var(--sky);
  }
  .opt-label {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .fps {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.82rem;
    color: var(--ink-2);
  }
  .fps input {
    width: 3.2rem;
    padding: 0.2rem 0.35rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
  .divider {
    height: 1px;
    margin: 0.3rem 0.1rem;
    border: none;
    background: var(--hairline);
  }
  .opt kbd {
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--hairline);
    border-radius: 5px;
    background: var(--paper);
    font-size: 0.72rem;
    font-family: inherit;
    color: var(--ink-2);
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
  .presets {
    display: flex;
    gap: 0.4rem;
  }
  .preset-chip {
    flex: 1;
    height: var(--key-h);
    padding: 0 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-weight: 650;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .preset-chip:hover {
    background: var(--sky);
  }
  .preset-chip.active {
    background: var(--electric);
    border-color: transparent;
    color: var(--canvas);
  }
  .preset-chip:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  /* One row per button, whole row is the tap target. */
  .toggles {
    display: flex;
    flex-direction: column;
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
    background: var(--ghost-2);
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
  /* The Signal Rule: the one red in the system belongs to "draw", and in the
     editor that is the pencil — not the ship action, which stays electric.
     Icon reads 3.63:1 on the tint (graphics need 3:1). */
  .editor :global(.key.active.draw) {
    background: color-mix(in srgb, var(--signal) 10%, transparent);
    border-color: var(--signal-dark);
    color: var(--signal-dark);
    box-shadow: 0 2px 0 var(--signal-dark);
  }
  .editor :global(.key.active.draw:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--signal) 16%, transparent);
    border-color: var(--signal-dark);
    box-shadow: 0 1px 0 var(--signal-dark);
  }
  .editor :global(.key.active.draw:active:not(:disabled)) {
    box-shadow: 0 0 0 var(--signal-dark);
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
