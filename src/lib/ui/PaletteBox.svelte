<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { TONIO_DEFAULT_PALETTE, contrastInk, gridStep, mergePalettes, type SavedPalette } from './color-palette';
  import Icon from './Icon.svelte';
  import ColourPicker from './ColourPicker.svelte';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  // Reference Palette sections: the grid (0), the saved list (1), edit mode (2).
  let section = $state<'colors' | 'saved' | 'edit'>('colors');
  let removerMode = $state(false);
  let preview = $state<SavedPalette | null>(null);
  /** Which big swatch the picker is open for, where it opened, and from what colour. */
  let picking = $state<{ target: 'outline' | 'fill'; x: number; y: number; origin: string } | null>(null);
  /** The grid, for scrolling the chosen outline into view. */
  let gridEl = $state<HTMLElement | null>(null);
  /** The grid is one Tab stop: the cell focus last stood on, else the outline. */
  let rove = $state(-1);
  const stop = $derived(
    rove >= 0 && rove < editor.palette.length ? rove : Math.max(0, editor.palette.indexOf(editor.brushColor)),
  );

  const outlineInGrid = $derived(editor.palette.includes(editor.brushColor));
  const fillInGrid = $derived(editor.palette.includes(editor.fillColor));
  const DEFAULT: SavedPalette = { id: -1, name: t('palette.default_name'), created: 0, colours: [...TONIO_DEFAULT_PALETTE] };
  const savedList = $derived([DEFAULT, ...editor.savedPalettes].reverse());

  /** Left button (or keyboard) → outline, right button → fill; remover mode deletes instead. */
  function onCell(e: MouseEvent, color: string): void {
    if (e.button !== 0 && e.button !== 2) return;
    if (removerMode) {
      editor.removePaletteColor(color);
      return;
    }
    editor.pickColor(color, e.button === 2 ? 'fill' : 'outline', true);
  }

  function openSection(next: 'colors' | 'saved' | 'edit'): void {
    section = section === next && next !== 'colors' ? 'colors' : next;
    removerMode = false;
    preview = null;
  }

  function savePalette(): void {
    const name = prompt(t('palette.save_prompt'), t('palette.new_name'));
    if (name) editor.saveCurrentPalette(name);
  }

  function usePalette(p: SavedPalette): void {
    if (!confirm(t('palette.replace_confirm'))) return;
    editor.replacePalette(p.colours);
    preview = null;
    section = 'colors';
  }

  /**
   * Reference MergePalette (`bundle:10653-10685`): the overflow warning comes
   * before anything is applied, and the count afterwards names the limit the
   * settings actually hold. A grid already at the limit has nothing to ask
   * about: it says so and stops, instead of confirming a merge of zero.
   */
  function mergePalette(p: SavedPalette): void {
    const limit = editor.settings.paletteLimit;
    const { added, skipped } = mergePalettes(editor.palette, p.colours, limit);
    if (added === 0) {
      alert(
        skipped === 0
          ? t('palette.all_present')
          : t('palette.full', { limit, skipped }),
      );
      return;
    }
    if (skipped > 0 && !confirm(t('palette.partial_confirm', { skipped, limit }))) {
      return;
    }
    editor.mergePalette(p.colours);
    alert(t('palette.added', { added }));
    preview = null;
    section = 'colors';
  }

  /** Reference `bundle:10493-10506`: the remover explains itself once, then never again. */
  function toggleRemover(): void {
    removerMode = !removerMode;
    if (!removerMode || editor.settings.removerTipShown) return;
    editor.setSetting('removerTipShown', true);
    alert(t('palette.remover_hint'));
  }

  function deletePalette(p: SavedPalette): void {
    if (!confirm(t('palette.delete_confirm'))) return;
    editor.deleteSavedPalette(p.id);
    preview = null;
  }

  function erasePalette(): void {
    if (!confirm(t('palette.erase_confirm'))) return;
    editor.replacePalette([]);
    openSection('colors');
  }

  /** The big swatch opens the picker under itself, clamped to the window. */
  function openPicker(e: MouseEvent, target: 'outline' | 'fill'): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picking = {
      target,
      x: Math.max(6, Math.min(r.left, window.innerWidth - 212)),
      y: Math.max(6, Math.min(r.bottom + 6, window.innerHeight - 392)),
      origin: target === 'fill' ? editor.fillColor : editor.brushColor,
    };
  }

  /**
   * The picker applies live without touching the grid. Esc asks for the colour
   * it opened on back; any other way out keeps what is chosen, and that colour
   * joins the grid under the reference's `paletteAutoAdd`.
   */
  function closePicker(options?: { revert?: boolean }): void {
    if (!picking) return;
    const { target, origin } = picking;
    if (options?.revert) {
      editor.pickColor(origin, target, true);
    } else if (editor.ux.colorGrid && editor.settings.paletteAutoAdd) {
      editor.addColorToPalette(target === 'fill' ? editor.fillColor : editor.brushColor);
    }
    picking = null;
  }

  /** Enter / Space press the cell; the arrows, Home and End walk the grid. */
  function onCellKey(e: KeyboardEvent, i: number, color: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCell(new MouseEvent('click', { button: e.shiftKey ? 2 : 0 }), color);
      return;
    }
    const cells = gridEl?.querySelectorAll<HTMLElement>('.cell');
    if (!gridEl || !cells) return;
    const cols = getComputedStyle(gridEl).gridTemplateColumns.split(' ').length;
    const next = gridStep(i, e.key, cells.length, cols);
    if (next === null) return;
    e.preventDefault();
    rove = next;
    cells[next].focus();
  }

  /* Reference `bundle:7783`: the grid follows the chosen outline. */
  $effect(() => {
    gridEl?.querySelector(`[data-color="${editor.brushColor}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  /** A color from the preview lands in the grid and on the outline / fill. */
  function onPreviewCell(e: MouseEvent, color: string): void {
    if (e.button !== 0 && e.button !== 2) return;
    editor.addColorToPalette(color);
    editor.pickColor(color, e.button === 2 ? 'fill' : 'outline', true);
  }
</script>

<!-- Reference `.panel.palette`: the two big colors with swap and «add», the
     grid (or the saved list) in the middle, a three-key strip at the foot. -->
<div class="box palette" role="group" aria-label={t('palette.box')}>
  <div class="main-colors">
    <div class="big" style:--swatch={editor.brushColor} style:color={contrastInk(editor.brushColor)}>
      <button
        class="face"
        title={t('palette.stroke_title')}
        aria-label={t('palette.stroke', { color: editor.brushColor })}
        aria-haspopup="dialog"
        onclick={(e) => openPicker(e, 'outline')}
      >
        <span class="mark"><Icon name="pencil" size={16} /></span>
      </button>
      {#if !outlineInGrid}
        <button class="add" onclick={() => editor.addColorToPalette(editor.brushColor)} title={t('palette.add_stroke_title')} aria-label={t('palette.add_stroke')}><Icon name="plus" size={16} /></button>
      {/if}
    </div>
    <div class="big" style:--swatch={editor.fillColor} style:color={contrastInk(editor.fillColor)}>
      <button
        class="face"
        title={t('palette.fill_title')}
        aria-label={t('palette.fill', { color: editor.fillColor })}
        aria-haspopup="dialog"
        onclick={(e) => openPicker(e, 'fill')}
      >
        <span class="mark"><Icon name="feather" size={16} /></span>
      </button>
      {#if !fillInGrid}
        <button class="add" onclick={() => editor.addColorToPalette(editor.fillColor)} title={t('palette.add_fill_title')} aria-label={t('palette.add_fill')}><Icon name="plus" size={16} /></button>
      {/if}
    </div>
    <button
      class="swap"
      onclick={() => editor.swapColors()}
      title={t('color.swap_title')}
      aria-label={t('color.swap')}
    ><Icon name="swap" size={16} /></button>
  </div>

  {#if section === 'saved'}
    <div class="saved" role="group" aria-label={t('palette.saved_group')}>
      <button class="tile add-tile" onclick={savePalette} title={t('palette.save_title')} aria-label={t('palette.save_title')}>
        <Icon name="plus" size={18} />
      </button>
      {#each savedList as p (p.id)}
        <button
          class="tile"
          class:active={preview?.id === p.id}
          onclick={() => (preview = preview?.id === p.id ? null : p)}
          title={t('palette.tile_title', { name: p.name || t('palette.new_name'), count: p.colours.length })}
          aria-label={t('palette.tile', { name: p.name || t('palette.new_name'), count: p.colours.length })}
        >
          {#each p.colours.slice(0, 30) as c, i (i)}
            <span class="micro" style:background={c}></span>
          {/each}
        </button>
      {/each}
    </div>
  {:else}
    <div class="grid" class:remover={removerMode} bind:this={gridEl} role="group" aria-label={t('palette.grid')}>
      {#each editor.palette as color, i (color)}
        {@const isOutline = editor.brushColor === color}
        {@const isFill = editor.fillColor === color}
        <button
          class="cell"
          data-color={color}
          style:--swatch={color}
          style:color={contrastInk(color)}
          onmousedown={(e) => onCell(e, color)}
          oncontextmenu={(e) => e.preventDefault()}
          tabindex={i === stop ? 0 : -1}
          onfocus={() => (rove = i)}
          onkeydown={(e) => onCellKey(e, i, color)}
          title={removerMode ? t('palette.remove_colour', { color }) : t('palette.colour_title', { color })}
          aria-label={removerMode ? t('palette.remove_colour', { color }) : t('palette.colour', { color })}
          aria-pressed={isOutline || isFill}
        >
          {#if removerMode}
            <Icon name="x" size={14} />
          {:else if isOutline && isFill}
            <Icon name="pencil" size={12} /><Icon name="feather" size={12} />
          {:else if isOutline}
            <Icon name="pencil" size={12} />
          {:else if isFill}
            <Icon name="feather" size={12} />
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <div class="foot" role="group" aria-label={t('palette.tools')}>
    <button
      class="foot-btn"
      class:active={section === 'edit'}
      aria-pressed={section === 'edit'}
      onclick={() => openSection('edit')}
      title={t('palette.edit')}
      aria-label={t('palette.edit')}
    ><Icon name="edit" size={18} /></button>
    {#if section === 'edit'}
      <button
        class="foot-btn"
        class:active={removerMode}
        aria-pressed={removerMode}
        onclick={toggleRemover}
        title={t('palette.remover')}
        aria-label={t('palette.remover_label')}
      ><Icon name="x" size={18} /></button>
      <button class="foot-btn danger" onclick={erasePalette} title={t('palette.erase')} aria-label={t('palette.erase')}><Icon name="trash" size={18} /></button>
    {:else}
      <button
        class="foot-btn"
        class:active={section === 'saved'}
        aria-pressed={section === 'saved'}
        onclick={() => openSection('saved')}
        title={t('palette.saved')}
        aria-label={t('palette.saved')}
      ><Icon name="palette" size={18} /></button>
      <button
        class="foot-btn"
        class:active={editor.tool === 'pipette'}
        aria-pressed={editor.tool === 'pipette'}
        onclick={() => editor.selectTool('pipette')}
        oncontextmenu={(e) => (e.preventDefault(), editor.selectTool('pipette', 'fill'))}
        title={t('palette.pipette_title')}
        aria-label={t('palette.pipette')}
      ><Icon name="pipette" size={18} /></button>
    {/if}
  </div>
</div>

<!-- Reference PalettePreview: the saved palette opened beside the box. -->
{#if preview}
  <div class="box preview" role="group" aria-label={t('palette.preview', { name: preview.name || t('palette.new_name') })}>
    <div class="preview-head">
      <strong>{preview.name || t('palette.new_name')}</strong>
      <button class="close" onclick={() => (preview = null)} aria-label={t('picker.close')}><Icon name="x" size={16} /></button>
    </div>
    <div class="grid preview-grid" role="group" aria-label={t('palette.preview_colours')}>
      {#each preview.colours as c, i (i)}
        <button
          class="cell"
          style:--swatch={c}
          style:color={contrastInk(c)}
          onmousedown={(e) => onPreviewCell(e, c)}
          oncontextmenu={(e) => e.preventDefault()}
          title={t('palette.colour_title', { color: c })}
          aria-label={t('palette.take_colour', { color: c })}
        ></button>
      {/each}
    </div>
    <div class="foot">
      <button class="foot-btn" onclick={() => preview && usePalette(preview)} title={t('palette.load')} aria-label={t('palette.load')}><Icon name="palette" size={18} /></button>
      <button class="foot-btn" onclick={() => preview && mergePalette(preview)} title={t('palette.merge')} aria-label={t('palette.merge')}><Icon name="plus" size={18} /></button>
      {#if preview.id >= 0}
        <button class="foot-btn danger" onclick={() => preview && deletePalette(preview)} title={t('palette.delete')} aria-label={t('palette.delete')}><Icon name="trash" size={18} /></button>
      {/if}
    </div>
  </div>
{/if}

{#if picking}
  <ColourPicker
    color={picking.target === 'fill' ? editor.fillColor : editor.brushColor}
    label={picking.target === 'fill' ? t('picker.fill') : t('picker.stroke')}
    x={picking.x}
    y={picking.y}
    model={editor.settings.pickerModel}
    onmodel={(next) => editor.setSetting('pickerModel', next)}
    onpick={(hex) => picking && editor.pickColor(hex, picking.target, true)}
    onclose={closePicker}
  />
{/if}

<style>
  .box {
    width: 225px;
    max-width: 100%;
    border: none;
    border-radius: var(--r-md);
    background: var(--canvas);
    /* Same reason as the brush box: the radius clips either way, and a rail
       with a ceiling squeezes this one too. */
    overflow: auto;
  }
  .palette {
    display: grid;
    grid-template-rows: auto minmax(32px, 1fr) auto;
  }
  .main-colors {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    min-height: 70px;
    border-bottom: 1px solid var(--hairline);
  }
  .big {
    position: relative;
    display: block;
    background: var(--swatch);
    cursor: pointer;
  }
  /* The swatch face fills the tile and opens the picker. */
  .face {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }
  /* The ring is drawn inside the swatch, so it takes the swatch's contrast ink:
     a red ring vanished on the red fill and on every red cell. */
  .face:focus-visible {
    outline: 3px solid currentColor;
    outline-offset: -3px;
  }
  /* Which swatch is which: the marker sits bottom-right in the contrast ink. */
  .mark {
    position: absolute;
    right: 4px;
    bottom: 4px;
    display: flex;
    pointer-events: none;
  }
  /* «Add to palette», bottom-left, only while the color is not in the grid.
     Drawn at the glyph's size and pressed at a finger's: a 44px circle painted
     here would cover a third of the colour block. The two press boxes below
     take their room from the swatch faces, which are 85x70 each and least
     useful exactly where these sit — and they are 72px apart, so neither
     reaches the other. */
  .add {
    position: absolute;
    left: 4px;
    bottom: 4px;
    display: flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .add::after,
  .swap::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--key-h, 2.75rem);
    height: var(--key-h, 2.75rem);
    transform: translate(-50%, -50%);
  }
  .swap {
    position: absolute;
    display: grid;
    place-items: center;
    top: 50%;
    left: 50%;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--sub);
    color: var(--ink);
    font: inherit;
    transform: translate(-50%, -50%);
    cursor: pointer;
  }
  .add:focus-visible,
  .swap:focus-visible,
  .close:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* The reference grid: 35px cells edge to edge, no gaps. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(35px, 1fr));
    max-height: 120px;
    overflow: auto;
    background: var(--sub);
  }
  .cell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--swatch);
    cursor: pointer;
  }
  .cell:focus-visible {
    outline: 3px solid currentColor;
    outline-offset: -3px;
  }
  .grid.remover .cell {
    cursor: not-allowed;
  }
  .grid.remover .cell :global(svg) {
    opacity: 0;
  }
  .grid.remover .cell:hover :global(svg) {
    opacity: 1;
  }
  /* Saved palettes: 60px tiles of micro colors plus the «save» tile. */
  .saved {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
    gap: 0.5em;
    max-height: 120px;
    padding: 0.5em;
    overflow: auto;
    background: var(--sub);
  }
  .tile {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    grid-template-rows: repeat(5, 1fr);
    min-height: 60px;
    padding: 0;
    border: 1px solid var(--edge);
    border-radius: var(--r-sm);
    background: var(--canvas);
    overflow: hidden;
    cursor: pointer;
  }
  .tile.active {
    outline: 2px solid var(--accent);
  }
  .tile:focus-visible {
    outline: 3px solid var(--accent);
  }
  .add-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-2);
  }
  .micro {
    display: block;
    width: 100%;
    height: 100%;
  }
  .foot {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    min-height: var(--key-h, 2.75rem);
    border-top: 1px solid var(--hairline);
  }
  .foot-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--key-h, 2.75rem);
    border: none;
    background: var(--canvas);
    color: var(--ink-2);
    cursor: pointer;
  }
  .foot-btn + .foot-btn {
    border-left: 1px solid var(--hairline);
  }
  .foot-btn:hover {
    background: var(--sub);
  }
  .foot-btn.active {
    background: color-mix(in srgb, var(--accent) 14%, var(--canvas));
    color: var(--accent-ink);
  }
  /* Full ink against the footer's secondary text: the key that throws work
     away reads heavier than the keys that keep it. Red is the drawing
     action's and nothing else's. */
  .foot-btn.danger {
    color: var(--ink);
  }
  .foot-btn:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  .preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--hairline);
    font-size: 0.9rem;
  }
  .preview-head strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--key-h);
    min-height: var(--key-h);
    padding: 0.1rem 0.4rem;
    border: none;
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    cursor: pointer;
  }
</style>
