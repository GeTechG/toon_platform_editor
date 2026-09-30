<script lang="ts">
  /**
   * The plain colour widget: the outline swatch, the fill swatch and the swap
   * between them (plus the quick pair, where the profile has one). The full
   * palette box is its own item — PaletteBox.
   */
  import type { EditorState } from './editor-state.svelte';
  import Icon from './Icon.svelte';
  import { contrastInk, gridStep, quickColours } from './color-palette';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  /** The strip is one Tab stop, like the palette box's grid: the cell focus
      last stood on, else the brush colour; the arrows walk the rest. */
  let rove = $state(-1);
  const stop = $derived(
    rove >= 0 && rove < editor.palette.length ? rove : Math.max(0, editor.palette.indexOf(editor.brushColor)),
  );

  function onCellKey(e: KeyboardEvent, i: number): void {
    const cells = (e.currentTarget as HTMLElement).parentElement?.children;
    if (!cells) return;
    // One row that scrolls sideways: up and down have nowhere to go.
    const next = gridStep(i, e.key, cells.length, cells.length);
    if (next === null || next === i) return;
    e.preventDefault();
    rove = next;
    (cells[next] as HTMLElement).focus();
  }

  /* A preset's pair is a plugin's to write: in upper case it never read as
     picked, «red» went into the brush, a repeat took the keyed row down. */
  const quickPalette = $derived(editor.paletteExpanded || !editor.ux.quickPalette ? null : quickColours(editor.ux.quickPalette));
  /** Either eraser: a pick hands the pencil back, so no colour is the one in hand. */
  const erasing = $derived(editor.tool === 'eraser' || editor.tool === 'mega-eraser');
  const strokeTitle = $derived(editor.ux.quickPalette ? editor.keyHint(t('color.stroke_title')) : t('color.stroke'));
</script>

{#if quickPalette}
  <div class="quick" role="group" aria-label={editor.keyHint(t('color.quick_group'))}>
    {#each quickPalette as color (color)}
      <button
        class="swatch"
        class:active={editor.brushColor === color && !erasing}
        aria-pressed={editor.brushColor === color && !erasing}
        style:--swatch={color}
        onclick={() => editor.pickColor(color, 'outline', true)}
        title={editor.keyHint(t('color.quick_title', { color }))}
        aria-label={t('color.swatch', { color })}
      ></button>
    {/each}
  </div>
{:else if editor.paletteExpanded}
  <!-- M hides the palette only where there is a quick pair; elsewhere M merges.
       The system window paints live and, closed on a colour, keeps it in the
       grid as the colour window does (the «добавлять выбранный цвет» setting). -->
  <label class="color" title={strokeTitle} style:--swatch={editor.brushColor}>
    <input
      type="color"
      aria-label={strokeTitle}
      value={editor.brushColor}
      oninput={(e) => editor.pickColor(e.currentTarget.value, 'outline', true)}
      onchange={(e) => editor.pickColor(e.currentTarget.value, 'outline')}
    />
  </label>
  <!-- Every preset draws with this one under the right button (CanvasView)
       and swaps the two on X — so every preset gets to choose it, whether or
       not it has the feather that also fills with it. -->
  <label class="color fill" title={t('color.fill_title')} style:--swatch={editor.fillColor}>
    <input
      type="color"
      aria-label={t('color.fill_title')}
      value={editor.fillColor}
      oninput={(e) => editor.pickColor(e.currentTarget.value, 'fill', true)}
      onchange={(e) => editor.pickColor(e.currentTarget.value, 'fill')}
    />
  </label>
  <button
    class="key icon"
    onclick={() => editor.swapColors()}
    title={editor.keyHint(t('color.swap_title'))}
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
      {#each editor.palette as color, i (color)}
        <button
          class="cell"
          class:active={editor.brushColor === color && !erasing}
          aria-pressed={editor.brushColor === color && !erasing}
          style:--swatch={color}
          style:color={contrastInk(color)}
          onclick={() => editor.pickColor(color, 'outline', true)}
          tabindex={i === stop ? 0 : -1}
          onfocus={() => (rove = i)}
          onkeydown={(e) => onCellKey(e, i)}
          title={t('color.swatch', { color })}
          aria-label={t('color.swatch', { color })}
        ></button>
      {/each}
      {#if editor.palette.length === 0}
        <p class="empty">{t('color.empty')}</p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  /* Quick two-color palette (Multator): round swatches, red ring when picked. */
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
  @media (hover: hover) {
    .swatch:hover {
      transform: translateY(-1px);
    }
  }
  .swatch.active {
    border-color: var(--canvas);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .swatch:focus-visible {
    outline: 3px solid var(--accent);
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
    padding-bottom: 1px;
  }
  .empty {
    margin: 0;
    align-self: center;
    color: var(--ink-2);
    font-size: 0.8rem;
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
  /* Both rings sit inside the cell: the strip scrolls sideways, and
     `overflow-x: auto` clips the other axis too — a ring outside lost its top
     and bottom. The chosen one is a white border over an accent band; focus
     is the cell's own contrast ink, as in the palette box. */
  .cell.active {
    border-color: var(--canvas);
    box-shadow: 0 0 0 1px var(--edge), inset 0 0 0 2px var(--accent);
  }
  .cell:focus-visible {
    outline: 3px solid currentColor;
    outline-offset: -3px;
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
  @supports selector(:has(*)) {
    .color:has(:focus-visible) {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
    }
  }
  /* Firefox 115 has no `:has()`: there the ring follows any focus in it, a
     click too — a ring too many rather than none for the keyboard. */
  @supports not selector(:has(*)) {
    .color:focus-within {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
    }
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
    @media (hover: hover) {
      .swatch:hover {
        transform: none;
      }
    }
  }
</style>
