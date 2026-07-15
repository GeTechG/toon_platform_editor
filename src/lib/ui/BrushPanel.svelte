<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { BRUSH_SIZES_LOGICAL } from '../format/constants';

  let { editor }: { editor: EditorState } = $props();
</script>

<div class="brush">
  {#each BRUSH_SIZES_LOGICAL as size (size)}
    <button
      class:active={editor.brushSizeLogical === size}
      onclick={() => (editor.brushSizeLogical = size)}
      title="Thickness {size}"
    >
      <span class="dot" style:width="{size + 2}px" style:height="{size + 2}px"></span>
    </button>
  {/each}
  <input type="color" bind:value={editor.brushColor} title="Brush color" />
</div>

<style>
  .brush {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  button {
    width: 2.2rem;
    height: 2.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }
  button.active {
    background: #eee;
    border-color: #ccc;
  }
  .dot {
    background: #111;
    border-radius: 50%;
  }
  input[type='color'] {
    width: 2.2rem;
    height: 2.2rem;
    margin-left: 1.5rem;
    padding: 0;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
</style>
