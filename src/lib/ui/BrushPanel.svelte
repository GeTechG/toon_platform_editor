<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { BRUSH_SIZES_LOGICAL } from '../format/constants';

  let { editor }: { editor: EditorState } = $props();
</script>

<div class="brush">
  <span class="label">Brush</span>
  {#each BRUSH_SIZES_LOGICAL as size (size)}
    <button
      class:active={editor.brushSizeLogical === size}
      onclick={() => (editor.brushSizeLogical = size)}
      title="Thickness {size}"
    >
      {size}
    </button>
  {/each}
  <input type="color" bind:value={editor.brushColor} title="Brush color" />
</div>

<style>
  .brush {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .label {
    font-size: 0.85rem;
    color: #666;
    margin-right: 0.25rem;
  }
  button {
    min-width: 2rem;
    min-height: 2rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
  button.active {
    background: #222;
    color: #fff;
    border-color: #222;
  }
  input[type='color'] {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
</style>
