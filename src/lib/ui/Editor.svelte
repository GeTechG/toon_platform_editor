<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState } from './editor-state.svelte';
  import CanvasView from './CanvasView.svelte';
  import BrushPanel from './BrushPanel.svelte';
  import ExportGifButton from './ExportGifButton.svelte';
  import Timeline from './Timeline.svelte';
  import PlayControls from './PlayControls.svelte';
  import { DRAFT_SAVE_DEBOUNCE_MS } from '../format/constants';
  import { debounce } from '../draft/debounce';
  import { decideRestore } from '../draft/restore';
  import { loadDraft, saveDraft } from '../draft/store';

  const editor = new EditorState();
  const scheduleSave = debounce((doc: unknown) => void saveDraft(doc), DRAFT_SAVE_DEBOUNCE_MS);

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
</script>

<div class="editor">
  <div class="topbar"></div>
  <div class="stage">
    <CanvasView {editor} />
  </div>
  <div class="panel">
    <div class="controls">
      <div class="tools t1">
        <button disabled={editor.playing} onclick={() => editor.addFrameAfterActive()} title="Add frame after current">
          ✚
        </button>
        <button disabled={editor.playing} onclick={() => editor.removeActiveFrame()} title="Delete current frame">
          ✖
        </button>
      </div>
      <div class="timeline">
        <Timeline {editor} />
      </div>
      <div class="row2">
        <PlayControls {editor} />
        <button
          class="onion"
          class:on={editor.onionSkin}
          aria-pressed={editor.onionSkin}
          onclick={() => editor.toggleOnionSkin()}
          title="Onion skin"
        >
          🧅
        </button>
        <ExportGifButton {editor} />
      </div>
      <div class="brush">
        <BrushPanel {editor} />
      </div>
    </div>
  </div>
</div>

<style>
  /* Full-screen column: bars stretch edge to edge, the canvas letterboxes
     in whatever is left between them. */
  .editor {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
  }
  .topbar {
    flex: none;
    height: 4.5rem;
    background: #d9d9d9;
  }
  .stage {
    flex: 1;
    min-height: 0;
  }
  /* Fixed-height bottom bar, controls anchored to its bottom. */
  .panel {
    flex: none;
    height: 12.5rem;
    box-sizing: border-box;
    background: #d9d9d9;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 0.5rem 0.75rem;
  }
  /* Rows mirror the reference: [✚✖ | timeline], [▶ 🧅 GIF],
     [· | brush dots]. */
  .controls {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas:
      't1   timeline'
      'row2 row2'
      '.    brush';
    gap: 0.3rem 0.6rem;
    align-items: start;
  }
  .tools {
    display: flex;
    gap: 0.25rem;
  }
  .t1 {
    grid-area: t1;
  }
  .timeline {
    grid-area: timeline;
    min-width: 0;
  }
  .row2 {
    grid-area: row2;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .brush {
    grid-area: brush;
  }
  .tools button,
  .row2 > button {
    min-width: 2.2rem;
    min-height: 2.2rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
  .tools button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .onion {
    opacity: 0.5;
  }
  .onion.on {
    opacity: 1;
    border-color: #888;
  }
</style>
