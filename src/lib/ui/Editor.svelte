<script lang="ts">
  import { EditorState } from './editor-state.svelte';
  import CanvasView from './CanvasView.svelte';
  import BrushPanel from './BrushPanel.svelte';
  import Timeline from './Timeline.svelte';
  import PlayControls from './PlayControls.svelte';

  const editor = new EditorState();
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
