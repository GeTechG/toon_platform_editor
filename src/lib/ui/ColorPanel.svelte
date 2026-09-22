<script lang="ts">
  /**
   * The plain colour widget: the outline swatch, the fill swatch and the swap
   * between them (plus the quick pair, where the profile has one). The full
   * palette box is its own item — PaletteBox.
   */
  import type { EditorState } from './editor-state.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  const quickPalette = $derived(editor.paletteExpanded ? null : editor.ux.quickPalette);
</script>

{#if quickPalette}
  <div class="quick" role="group" aria-label={t('color.quick_group')}>
    {#each quickPalette as color (color)}
      <button
        class="swatch"
        class:active={editor.brushColor === color && editor.tool !== 'eraser'}
        aria-pressed={editor.brushColor === color && editor.tool !== 'eraser'}
        style:--swatch={color}
        onclick={() => editor.setBrushColor(color)}
        title={t('color.quick_title', { color })}
        aria-label={t('color.swatch', { color })}
      ></button>
    {/each}
  </div>
{:else if editor.paletteExpanded}
  <label class="color" title={t('color.stroke_title')} style:--swatch={editor.brushColor}>
    <input
      type="color"
      value={editor.brushColor}
      oninput={(e) => editor.setBrushColor(e.currentTarget.value)}
    />
  </label>
  <!-- Every preset draws with this one under the right button (CanvasView)
       and swaps the two on X — so every preset gets to choose it, whether or
       not it has the feather that also fills with it. -->
  <label class="color fill" title={t('color.fill_title')} style:--swatch={editor.fillColor}>
    <input
      type="color"
      value={editor.fillColor}
      oninput={(e) => (editor.fillColor = e.currentTarget.value.toLowerCase())}
    />
  </label>
  <button
    class="key icon"
    onclick={() => editor.swapColors()}
    title={t('color.swap_title')}
    aria-label={t('color.swap')}
  ><Icon name="swap" /></button>
  {#if editor.ux.colorGrid}
    <button
      class="key icon"
      onclick={() => editor.addCurrentColorToPalette()}
      title={t('color.add')}
      aria-label={t('color.add')}
    ><Icon name="plus" /></button>
    <div class="grid" role="group" aria-label={t('color.grid')}>
      {#each editor.palette as color (color)}
        <button
          class="cell"
          class:active={editor.brushColor === color && editor.tool !== 'eraser'}
          aria-pressed={editor.brushColor === color && editor.tool !== 'eraser'}
          style:--swatch={color}
          onclick={() => editor.setBrushColor(color)}
          title={t('color.swatch', { color })}
          aria-label={t('color.swatch', { color })}
        ></button>
      {/each}
    </div>
  {/if}
{/if}

<style>
  /* Quick two-color palette (Multator): round swatches, electric ring when picked. */
  .quick {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .swatch {
    width: var(--key-h);
    height: var(--key-h);
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: 0 0 0 1px var(--edge);
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.13s ease;
  }
  .swatch:hover {
    transform: translateY(-1px);
  }
  .swatch.active {
    border-color: var(--canvas);
    box-shadow: 0 0 0 2px var(--electric);
  }
  .swatch:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  /* Saved colour strip (Tonio): the row it stands in is already a key tall,
     so a 24px cell was twenty empty pixels, not room saved. The strip scrolls
     sideways either way — the floor costs visible swatches, not the row. */
  .grid {
    display: flex;
    gap: 3px;
    max-width: 16rem;
    overflow-x: auto;
    scrollbar-width: thin;
    padding-bottom: 1px;
  }
  .cell {
    flex: 0 0 auto;
    width: var(--key-h);
    height: var(--key-h);
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--r-sm);
    background: var(--swatch);
    box-shadow: 0 0 0 1px var(--edge);
    cursor: pointer;
  }
  .cell.active {
    border-color: var(--canvas);
    box-shadow: 0 0 0 2px var(--electric);
  }
  .cell:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  /* Native picker as a round brand swatch showing the live color. */
  .color {
    display: inline-flex;
    width: var(--key-h);
    height: var(--key-h);
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: 0 0 0 1px var(--edge), inset 0 0 0 2px var(--canvas);
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
  @media (prefers-reduced-motion: reduce) {
    .swatch {
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .swatch:hover {
      transform: none;
    }
  }
</style>
