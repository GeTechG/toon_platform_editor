<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState } from './editor-state.svelte';
  import CanvasView from './CanvasView.svelte';
  import BrushPanel from './BrushPanel.svelte';
  import ExportGifButton from './ExportGifButton.svelte';
  import LayersPanel from './LayersPanel.svelte';
  import Timeline from './Timeline.svelte';
  import PlayControls from './PlayControls.svelte';
  import Icon from './Icon.svelte';
  import { DRAFT_SAVE_DEBOUNCE_MS, PLAYER_FPS_MAX, PLAYER_FPS_MIN } from '../format/constants';
  import { debounce } from '../draft/debounce';
  import { decideRestore } from '../draft/restore';
  import { loadDraft, saveDraft } from '../draft/store';
  import { FEATURE_LABELS, FEATURE_ORDER, PRESETS } from './presets';
  import type { FeatureKey } from './presets';
  import type { IconName } from './Icon.svelte';
  import type { ToonDocument } from '../format/types';

  // Icon per toggle where one maps cleanly — makes each row recognizable at a
  // glance; the rest fall back to their label alone.
  const FEATURE_ICONS: Partial<Record<FeatureKey, IconName>> = {
    addFrame: 'plus',
    deleteFrame: 'x',
    play: 'play',
    export: 'download',
    tools: 'pencil',
    onionSkin: 'onion',
  };

  // Optional publish hook. When a host app provides it, a Publish button appears
  // and hands the host a plain snapshot of the current document; the editor
  // itself stays unaware of what publishing means (no network, no platform
  // coupling).
  let { onPublish }: { onPublish?: (doc: ToonDocument) => void } = $props();

  const editor = new EditorState();
  const scheduleSave = debounce((doc: unknown) => void saveDraft(doc), DRAFT_SAVE_DEBOUNCE_MS);

  // Root element, so F can request fullscreen on the whole editor.
  let editorEl: HTMLDivElement;
  let layersOpen = $state(false);

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
    void doc.layers.length;
    for (const layer of doc.layers) {
      void layer.hidden;
      void layer.frames.length;
      for (const cell of layer.frames) {
        void cell.strokes.length;
      }
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

  // Settings popover (opens above the ⚙ key): holds the everyday controls the
  // reference bar has no room for — onion skin, playback fps, fullscreen.
  let settingsOpen = $state(false);
  // Customization sheet: which buttons the toolbar shows, and the active preset.
  // A set-once concern, so it lives in its own roomy sheet, not the quick popover.
  let customizeOpen = $state(false);

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
    {#if flashVisible}
      <div class="flash" aria-hidden="true"></div>
    {/if}
  </div>
  <div class="panel">
    <div class="toolbar">
      <!-- Row A — frames: add / delete anchor the timeline strip. -->
      <div class="row frames">
        {#if editor.features.addFrame}
          <button
            class="key icon"
            disabled={editor.playing}
            onclick={onAddFrame}
            title="Add frame after current (Ctrl+click: before)"
          >
            <Icon name="plus" />
          </button>
        {/if}
        {#if editor.features.deleteFrame}
          <button
            class="key icon"
            disabled={editor.playing}
            onclick={() => editor.removeActiveFrame()}
            title="Delete current frame"
          >
            <Icon name="x" />
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
      <div class="row transport">
        {#if editor.features.play}
          <PlayControls {editor} />
        {/if}
        {#if editor.features.onionSkin}
          <button
            class="key icon"
            class:active={editor.onionSkin}
            aria-pressed={editor.onionSkin}
            onclick={() => editor.toggleOnionSkin()}
            title={editor.onionSkin ? 'Onion skin on' : 'Onion skin off'}
          >
            <Icon name="onion" />
          </button>
        {/if}
        {#if editor.features.layers}
          <div class="layers">
            <button
              class="key icon"
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
        {#if editor.features.export}
          <ExportGifButton {editor} />
        {/if}
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

      <!-- Row C — drawing: tools · sizes · color, with settings anchored in the
           otherwise-empty bottom-right corner. -->
      <div class="row draw">
        <BrushPanel {editor} />
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

              <!-- The gear is never hideable, so customization is always reachable. -->
              <hr class="divider" />
              <button class="opt opt-btn" onclick={openCustomize}>
                <span class="opt-label"><Icon name="gear" size={18} /> Customize toolbar…</span>
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Customization sheet: roomy, one concern per row, big tap targets. -->
  {#if customizeOpen}
    <div
      class="sheet-backdrop"
      role="button"
      tabindex="-1"
      aria-label="Close customization"
      onclick={() => (customizeOpen = false)}
      onkeydown={(e) => e.key === 'Escape' && (customizeOpen = false)}
    ></div>
    <div class="sheet" role="dialog" aria-label="Customize toolbar" aria-modal="true">
      <header class="sheet-head">
        <h2>Customize toolbar</h2>
        <button class="key icon" onclick={() => (customizeOpen = false)} aria-label="Close">
          <Icon name="x" />
        </button>
      </header>

      <div class="sheet-body">
        <p class="sheet-hint">Preset</p>
        <div class="presets" role="group" aria-label="Preset">
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

        {#if editor.preset === 'toonio'}
          <div class="tonio-preset-settings" aria-label="Настройки линии Tonio">
            <label class="number-setting">
              <span>Сглаживание</span>
              <input
                type="number"
                min="1"
                max="100"
                value={editor.tonioSmooth}
                oninput={(event) => editor.setTonioSmooth(event.currentTarget.valueAsNumber)}
              />
            </label>
            <label class="number-setting">
              <span>Мин. расстояние</span>
              <input
                type="number"
                min="0"
                max="30"
                value={editor.tonioMinDistance}
                oninput={(event) => editor.setTonioMinDistance(event.currentTarget.valueAsNumber)}
              />
            </label>
          </div>
        {/if}

        <p class="sheet-hint">Buttons</p>
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
      </div>

      <footer class="sheet-foot">
        <button class="key" onclick={() => editor.resetFeatures()}>Reset to preset</button>
        <button class="key primary" onclick={() => (customizeOpen = false)}>Done</button>
      </footer>
    </div>
  {/if}
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
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--paper);
    padding: clamp(0.5rem, 2.2vw, 1.25rem);
    box-sizing: border-box;
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
    /* Anchor to the empty bottom-right corner of the draw row. */
    margin-left: auto;
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

  /* ---- Customization sheet ---- */
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    border: none;
    background: rgba(11, 12, 16, 0.42);
  }
  /* Bottom sheet on mobile, centered card on wider screens. */
  .sheet {
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
    .sheet {
      left: 50%;
      right: auto;
      bottom: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(24rem, calc(100vw - 2rem));
      border-radius: var(--r-md);
    }
  }
  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1rem 0.6rem;
    border-bottom: 1px solid var(--hairline);
  }
  .sheet-head h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
  }
  .sheet-body {
    overflow-y: auto;
    padding: 0.4rem 1rem 0.6rem;
  }
  .sheet-hint {
    margin: 0.7rem 0 0.4rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
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
  .tonio-preset-settings {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
    margin-top: 0.65rem;
  }
  .number-setting {
    display: grid;
    gap: 0.25rem;
    color: var(--ink-2);
    font-size: 0.74rem;
    font-weight: 700;
  }
  .number-setting input {
    width: 100%;
    min-height: 2.75rem;
    box-sizing: border-box;
    padding-inline: 0.55rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
  .number-setting input:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  /* One row per button, whole row is the tap target. */
  .toggles {
    display: flex;
    flex-direction: column;
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2.9rem;
    padding: 0 0.3rem;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .toggle:hover {
    background: var(--sky);
  }
  .toggle + .toggle {
    border-top: 1px solid var(--hairline-soft);
  }
  .toggle-label {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.95rem;
  }
  /* Bigger, brand-colored checkboxes — comfortable touch targets. */
  .toggle input {
    width: 1.3rem;
    height: 1.3rem;
    accent-color: var(--electric);
    cursor: pointer;
  }
  .sheet-foot {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.7rem 1rem;
    padding-bottom: max(0.7rem, env(safe-area-inset-bottom));
    border-top: 1px solid var(--hairline);
  }

  /* ---- Shared button vocabulary (global so child components inherit it) ---- */
  /* Ghost key: quiet toolbar action on canvas, 1px hairline, small press. */
  .editor :global(.key) {
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
  .editor :global(.key.icon) {
    padding: 0;
  }
  .editor :global(.key:hover:not(:disabled)) {
    background: var(--sky);
    border-color: var(--electric);
  }
  .editor :global(.key:active:not(:disabled)) {
    transform: translateY(1px);
  }
  .editor :global(.key:focus-visible) {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  .editor :global(.key:disabled) {
    opacity: 0.4;
    cursor: default;
  }
  .editor :global(.key.active) {
    background: var(--ghost-2);
    border-color: var(--electric);
    color: var(--electric);
  }
  /* Primary key: the one positive "ship" action — electric physical key. */
  /* Primary shares the exact key footprint — set apart by electric fill, not
     size or a protruding shadow. */
  .editor :global(.key.primary) {
    padding: 0 0.9rem;
    border-color: transparent;
    background: var(--electric);
    color: var(--canvas);
  }
  .editor :global(.key.primary.icon) {
    padding: 0;
  }
  .editor :global(.key.primary:hover:not(:disabled)) {
    background: var(--electric-dark);
    border-color: transparent;
  }

  @media (prefers-reduced-motion: reduce) {
    .editor :global(.key) {
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .editor :global(.key:active:not(:disabled)) {
      transform: none;
    }
  }
</style>
