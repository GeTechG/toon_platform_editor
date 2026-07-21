<script lang="ts">
  import type { EditorState, Tool } from './editor-state.svelte';
  import { BRUSH_SIZES_LOGICAL } from '../format/constants';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  const TOOLS: { id: Tool; icon: IconName; title: string }[] = [
    { id: 'pencil', icon: 'pencil', title: 'Pencil (B)' },
    { id: 'eraser', icon: 'eraser', title: 'Eraser (E)' },
    { id: 'pipette', icon: 'pipette', title: 'Eyedropper (P)' },
  ];
</script>

<div class="brush">
  {#if editor.features.tools}
    <div class="tools">
      {#each TOOLS as t (t.id)}
        <button
          class="key icon"
          class:active={editor.tool === t.id}
          aria-pressed={editor.tool === t.id}
          onclick={() => (editor.tool = t.id)}
          title={t.title}
        >
          <Icon name={t.icon} />
        </button>
      {/each}
    </div>
  {/if}

  {#if editor.features.tools && editor.features.sizes}
    <span class="sep"></span>
  {/if}

  {#if editor.features.sizes}
    <div class="sizes">
      {#each BRUSH_SIZES_LOGICAL as size (size)}
        <button
          class="size-btn"
          class:active={editor.brushSizeLogical === size}
          aria-pressed={editor.brushSizeLogical === size}
          onclick={() => (editor.brushSizeLogical = size)}
          title="Thickness {size}"
        >
          <span class="dot" style:width="{Math.min(size + 2, 22)}px" style:height="{Math.min(size + 2, 22)}px"></span>
        </button>
      {/each}
    </div>
    <span class="size" title="Brush size — +/− to adjust">{editor.brushSizeLogical}px</span>
  {/if}

  {#if editor.features.color && editor.showPalette}
    <label class="color" title="Brush color (M to hide)" style:--swatch={editor.brushColor}>
      <input type="color" bind:value={editor.brushColor} />
    </label>
  {/if}
</div>

<style>
  .brush {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem 0.5rem;
    min-width: 0;
  }
  .tools,
  .sizes {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--hairline);
    margin: 0.15rem 0.2rem;
  }
  /* Size dots read as one control group — quiet until picked, electric ring
     when active, echoing the reference's row of growing dots. */
  .size-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: transparent;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .size-btn:hover {
    background: var(--sky);
  }
  .size-btn.active {
    background: var(--ghost-2);
    border-color: var(--electric);
  }
  .size-btn:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  .dot {
    background: var(--ink);
    border-radius: 50%;
  }
  .size {
    min-width: 2.75rem;
    font-size: 0.74rem;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  /* Native picker as a round brand swatch showing the live color. */
  .color {
    display: inline-flex;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: 0 0 0 1px var(--hairline), inset 0 0 0 2px var(--canvas);
    cursor: pointer;
  }
  .color:focus-within {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  .color input {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    opacity: 0;
    cursor: pointer;
  }
</style>
