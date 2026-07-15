<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState } from './editor-state.svelte';
  import CanvasView from './CanvasView.svelte';
  import BrushPanel from './BrushPanel.svelte';
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
  <CanvasView {editor} />
  <div class="panels">
    <BrushPanel {editor} />
    <PlayControls {editor} />
  </div>
  <Timeline {editor} />
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .panels {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.25rem;
    align-items: center;
  }
</style>
