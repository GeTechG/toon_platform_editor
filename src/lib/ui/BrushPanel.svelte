<script lang="ts">
  import type { EditorState, Tool } from './editor-state.svelte';
  import { BRUSH_SIZES_LOGICAL } from '../format/constants';

  let { editor }: { editor: EditorState } = $props();

  const TOOLS: { id: Tool; icon: string; title: string }[] = [
    { id: 'pencil', icon: '✏️', title: 'Pencil (B)' },
    { id: 'eraser', icon: '🧽', title: 'Eraser (E)' },
    { id: 'pipette', icon: '💧', title: 'Eyedropper (P)' },
  ];
</script>

<div class="brush">
  {#each TOOLS as t (t.id)}
    <button class:active={editor.tool === t.id} onclick={() => (editor.tool = t.id)} title={t.title}>
      {t.icon}
    </button>
  {/each}
  <span class="sep"></span>
  {#each BRUSH_SIZES_LOGICAL as size (size)}
    <button
      class:active={editor.brushSizeLogical === size}
      onclick={() => (editor.brushSizeLogical = size)}
      title="Thickness {size}"
    >
      <span class="dot" style:width="{size + 2}px" style:height="{size + 2}px"></span>
    </button>
  {/each}
  <span class="size" title="Brush size — +/− to adjust">{editor.brushSizeLogical}px</span>
  {#if editor.showPalette}
    <input type="color" bind:value={editor.brushColor} title="Brush color (M to hide)" />
  {/if}
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
  .sep {
    width: 1px;
    height: 1.5rem;
    background: #bbb;
    margin: 0 0.5rem;
  }
  .size {
    min-width: 2.75rem;
    font-size: 0.8rem;
    color: #555;
    font-variant-numeric: tabular-nums;
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
