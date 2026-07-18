<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState } from './editor-state.svelte';
  import CanvasView from './CanvasView.svelte';
  import BrushPanel from './BrushPanel.svelte';
  import ExportGifButton from './ExportGifButton.svelte';
  import Timeline from './Timeline.svelte';
  import PlayControls from './PlayControls.svelte';
  import Icon from './Icon.svelte';
  import { DRAFT_SAVE_DEBOUNCE_MS, PLAYER_FPS_MAX, PLAYER_FPS_MIN } from '../format/constants';
  import { debounce } from '../draft/debounce';
  import { decideRestore } from '../draft/restore';
  import { loadDraft, saveDraft } from '../draft/store';
  import type { ToonDocument } from '../format/types';

  // Optional publish hook. When a host app provides it, a Publish button appears
  // and hands the host a plain snapshot of the current document; the editor
  // itself stays unaware of what publishing means (no network, no platform
  // coupling).
  let { onPublish }: { onPublish?: (doc: ToonDocument) => void } = $props();

  const editor = new EditorState();
  const scheduleSave = debounce((doc: unknown) => void saveDraft(doc), DRAFT_SAVE_DEBOUNCE_MS);

  // Root element, so F can request fullscreen on the whole editor.
  let editorEl: HTMLDivElement;

  function toggleFullscreen(): void {
    if (!document.fullscreenEnabled) {
      return;
    }
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : editorEl.requestFullscreen();
    void request.catch(() => {});
  }

  // Editor hotkeys, matching the reference editors: bare single keys, ignored
  // while typing in a form field or when a browser/OS modifier is held.
  function onKeydown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) {
      return;
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
        editor.tool = 'pencil';
        break;
      case 'e':
      case 'E':
        editor.tool = 'eraser';
        break;
      case 'p':
      case 'P':
        editor.tool = 'pipette';
        break;
      case 'c':
      case 'C':
        editor.copyActiveFrame();
        break;
      case 'v':
      case 'V':
        editor.pasteFrame();
        break;
      case 'z':
      case 'Z':
        editor.undo();
        break;
      case 'm':
      case 'M':
        editor.togglePalette();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
    }
  }

  // Autosave after the first edit: track the change signals (fps, frame
  // count, per-frame stroke count — strokes are append-only), snapshot the
  // document to a plain object, and persist it debounced. Skipping the
  // untouched document also avoids clobbering a draft before restore runs.
  $effect(() => {
    if (!editor.touched) {
      return;
    }
    const doc = editor.doc;
    void doc.frame_rate;
    void doc.frames.length;
    for (const frame of doc.frames) {
      void frame.strokes.length;
    }
    scheduleSave($state.snapshot(doc));
    return () => scheduleSave.cancel();
  });

  // Restore a saved draft on start — but only if the user has not edited
  // during the async load, and only if it passes validation.
  onMount(async () => {
    const restored = decideRestore(await loadDraft(), editor.touched);
    if (restored) {
      editor.replaceDoc(restored);
    }
  });

  // Settings popover (opens above the ⚙ key): holds the controls the reference
  // bar has no room for — onion skin, playback fps, fullscreen.
  let settingsOpen = $state(false);

  function onFpsChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    editor.setFps(Number(input.value));
    input.value = String(editor.doc.frame_rate);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="editor" bind:this={editorEl}>
  <div class="stage">
    <CanvasView {editor} />
  </div>
  <div class="panel">
    <div class="toolbar">
      <!-- Row A — frames: add / delete anchor the timeline strip. -->
      <div class="row frames">
        <button
          class="key icon"
          disabled={editor.playing}
          onclick={() => editor.addFrameAfterActive()}
          title="Add frame after current"
        >
          <Icon name="plus" />
        </button>
        <button
          class="key icon"
          disabled={editor.playing}
          onclick={() => editor.removeActiveFrame()}
          title="Delete current frame"
        >
          <Icon name="x" />
        </button>
        <div class="timeline">
          <Timeline {editor} />
        </div>
      </div>

      <!-- Row B — transport & output: play at left like the reference,
           settings / export next to it, publish anchored right. -->
      <div class="row transport">
        <PlayControls {editor} />
        <div class="settings">
          <button
            class="key icon"
            class:active={settingsOpen}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            onclick={() => (settingsOpen = !settingsOpen)}
            title="Settings"
          >
            <Icon name="gear" />
          </button>
          {#if settingsOpen}
            <button class="backdrop" aria-label="Close settings" onclick={() => (settingsOpen = false)}></button>
            <div class="popover" role="dialog" aria-label="Settings">
              <label class="opt">
                <span class="opt-label"><Icon name="onion" size={18} /> Onion skin</span>
                <input type="checkbox" checked={editor.onionSkin} onchange={() => editor.toggleOnionSkin()} />
              </label>
              <label class="opt">
                <span class="opt-label">Frame rate</span>
                <span class="fps">
                  <input
                    type="number"
                    min={PLAYER_FPS_MIN}
                    max={PLAYER_FPS_MAX}
                    value={editor.doc.frame_rate}
                    onchange={onFpsChange}
                    disabled={editor.playing}
                  />
                  fps
                </span>
              </label>
              {#if document.fullscreenEnabled}
                <button class="opt opt-btn" onclick={toggleFullscreen}>
                  <span class="opt-label">Fullscreen</span>
                  <kbd>F</kbd>
                </button>
              {/if}
            </div>
          {/if}
        </div>
        <ExportGifButton {editor} />
        {#if onPublish}
          <button
            class="key primary icon publish"
            onclick={() => onPublish?.($state.snapshot(editor.doc))}
            title="Publish"
            aria-label="Publish"
          >
            <Icon name="send" />
          </button>
        {/if}
      </div>

      <!-- Row C — drawing: tools · sizes · color. -->
      <div class="row draw">
        <BrushPanel {editor} />
      </div>
    </div>
  </div>
</div>

<style>
  /* toonop tokens (DESIGN.md): чернила / бумага / холст / электрик / сигнал.
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
    --signal-dark: #d8331c;
    --hairline: #0b0c1024;
    --hairline-soft: #0b0c1012;
    --ghost-2: #1b5cff1a;
    --r-sm: 7px;
    --r-md: 14px;
    --key-h: 2.5rem;

    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  /* Paper worktable so the white canvas floats on brand tone, not a bare dark
     letterbox. Padding keeps the canvas off the bars. */
  .stage {
    flex: 1;
    min-height: 0;
    background: var(--paper);
    padding: clamp(0.5rem, 2.2vw, 1.25rem);
    box-sizing: border-box;
  }
  /* Bottom toolbar — the second neutral layer over the white canvas. */
  .panel {
    flex: none;
    box-sizing: border-box;
    background: var(--paper);
    border-top: 1px solid var(--hairline);
    padding: 0.6rem 0.9rem;
  }
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
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
  /* Full-screen catcher so a click anywhere dismisses the popover. */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1;
    border: none;
    background: transparent;
    cursor: default;
  }
  .popover {
    position: absolute;
    bottom: calc(100% + 0.4rem);
    left: 0;
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
  .opt kbd {
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--hairline);
    border-radius: 5px;
    background: var(--paper);
    font-size: 0.72rem;
    font-family: inherit;
    color: var(--ink-2);
  }

  /* ---- Shared button vocabulary (global so child components inherit it) ---- */
  /* Ghost key: quiet toolbar action on canvas, 1px hairline, small press. */
  .toolbar :global(.key) {
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
    transition:
      transform 0.13s cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 0.13s cubic-bezier(0.2, 0.8, 0.2, 1),
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .toolbar :global(.key.icon) {
    padding: 0;
  }
  .toolbar :global(.key:hover:not(:disabled)) {
    background: var(--sky);
    border-color: var(--electric);
  }
  .toolbar :global(.key:active:not(:disabled)) {
    transform: translateY(1px);
  }
  .toolbar :global(.key:focus-visible) {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  .toolbar :global(.key:disabled) {
    opacity: 0.4;
    cursor: default;
  }
  .toolbar :global(.key.active) {
    background: var(--ghost-2);
    border-color: var(--electric);
    color: var(--electric);
  }
  /* Primary key: the one positive "ship" action — electric physical key. */
  /* Primary shares the exact key footprint — set apart by electric fill, not
     size or a protruding shadow. */
  .toolbar :global(.key.primary) {
    padding: 0 0.9rem;
    border-color: transparent;
    background: var(--electric);
    color: var(--canvas);
  }
  .toolbar :global(.key.primary.icon) {
    padding: 0;
  }
  .toolbar :global(.key.primary:hover:not(:disabled)) {
    background: var(--electric-dark);
    border-color: transparent;
  }

  @media (prefers-reduced-motion: reduce) {
    .toolbar :global(.key) {
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .toolbar :global(.key:active:not(:disabled)) {
      transform: none;
    }
  }
</style>
