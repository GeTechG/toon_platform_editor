<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { TONIO_DEFAULT_PALETTE, contrastInk, mergePalettes, type SavedPalette } from './color-palette';
  import Icon from './Icon.svelte';
  import ColourPicker from './ColourPicker.svelte';

  let { editor }: { editor: EditorState } = $props();

  // Reference Palette sections: the grid (0), the saved list (1), edit mode (2).
  let section = $state<'colors' | 'saved' | 'edit'>('colors');
  let removerMode = $state(false);
  let preview = $state<SavedPalette | null>(null);
  /** Which big swatch the picker is open for, where it opened, and from what colour. */
  let picking = $state<{ target: 'outline' | 'fill'; x: number; y: number; origin: string } | null>(null);
  /** The grid, for scrolling the chosen outline into view. */
  let gridEl = $state<HTMLElement | null>(null);

  const twoColors = $derived(editor.ux.tools.includes('feather'));
  const outlineInGrid = $derived(editor.palette.includes(editor.brushColor));
  const fillInGrid = $derived(editor.palette.includes(editor.fillColor));
  const DEFAULT: SavedPalette = { id: -1, name: 'По умолчанию', created: 0, colours: [...TONIO_DEFAULT_PALETTE] };
  const savedList = $derived([DEFAULT, ...editor.savedPalettes].reverse());

  /** Left button (or keyboard) → outline, right button → fill; remover mode deletes instead. */
  function onCell(e: MouseEvent, color: string): void {
    if (e.button !== 0 && e.button !== 2) return;
    if (removerMode) {
      editor.removePaletteColor(color);
      return;
    }
    editor.pickColor(color, e.button === 2 && twoColors ? 'fill' : 'outline', true);
  }

  function openSection(next: 'colors' | 'saved' | 'edit'): void {
    section = section === next && next !== 'colors' ? 'colors' : next;
    removerMode = false;
    preview = null;
  }

  function savePalette(): void {
    const name = prompt('Название палитры', 'Новая палитра');
    if (name) editor.saveCurrentPalette(name);
  }

  function usePalette(p: SavedPalette): void {
    if (!confirm('Осторожно: новая палитра заменит текущую.\nВозможно, стоит сначала сохранить текущую.\nПродолжить?')) return;
    editor.replacePalette(p.colours);
    preview = null;
    section = 'colors';
  }

  /**
   * Reference MergePalette (`bundle:10653-10685`): the overflow warning comes
   * before anything is applied, and the count afterwards names the limit the
   * settings actually hold.
   */
  function mergePalette(p: SavedPalette): void {
    const limit = editor.settings.paletteLimit;
    const { added, skipped } = mergePalettes(editor.palette, p.colours, limit);
    if (added === 0 && skipped === 0) {
      alert('Все эти цвета уже есть в текущей палитре.');
      return;
    }
    if (skipped > 0 && !confirm(`Не поместится ${skipped} — лимит палитры ${limit}.\nПродолжить?`)) {
      return;
    }
    editor.mergePalette(p.colours);
    alert(`Добавлено ${added}`);
    preview = null;
    section = 'colors';
  }

  /** Reference `bundle:10493-10506`: the remover explains itself once, then never again. */
  function toggleRemover(): void {
    removerMode = !removerMode;
    if (!removerMode || editor.settings.removerTipShown) return;
    editor.setSetting('removerTipShown', true);
    alert('Щёлкай по цветам, чтобы убрать их из палитры.');
  }

  function deletePalette(p: SavedPalette): void {
    if (!confirm('Удалить эту палитру?')) return;
    editor.deleteSavedPalette(p.id);
    preview = null;
  }

  function erasePalette(): void {
    if (!confirm('Точно очистить текущую палитру?')) return;
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

  /* Reference `bundle:7783`: the grid follows the chosen outline. */
  $effect(() => {
    gridEl?.querySelector(`[data-color="${editor.brushColor}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  /** A color from the preview lands in the grid and on the outline / fill. */
  function onPreviewCell(e: MouseEvent, color: string): void {
    if (e.button !== 0 && e.button !== 2) return;
    editor.addColorToPalette(color);
    editor.pickColor(color, e.button === 2 && twoColors ? 'fill' : 'outline', true);
  }
</script>

<!-- Reference `.panel.palette`: the two big colors with swap and «add», the
     grid (or the saved list) in the middle, a three-key strip at the foot. -->
<div class="box palette" aria-label="Цвета">
  <div class="main-colors">
    <div class="big" style:--swatch={editor.brushColor} style:color={contrastInk(editor.brushColor)}>
      <button
        class="face"
        title="Цвет контура (ЛКМ)"
        aria-label="Цвет контура {editor.brushColor}"
        aria-haspopup="dialog"
        onclick={(e) => openPicker(e, 'outline')}
      >
        <span class="mark"><Icon name="pencil" size={16} /></span>
      </button>
      {#if !outlineInGrid}
        <button class="add" onclick={() => editor.addColorToPalette(editor.brushColor)} title="Добавить контур в палитру" aria-label="Добавить цвет контура в палитру"><Icon name="plus" size={16} /></button>
      {/if}
    </div>
    {#if twoColors}
      <div class="big" style:--swatch={editor.fillColor} style:color={contrastInk(editor.fillColor)}>
        <button
          class="face"
          title="Цвет заливки (ПКМ)"
          aria-label="Цвет заливки {editor.fillColor}"
          aria-haspopup="dialog"
          onclick={(e) => openPicker(e, 'fill')}
        >
          <span class="mark"><Icon name="feather" size={16} /></span>
        </button>
        {#if !fillInGrid}
          <button class="add" onclick={() => editor.addColorToPalette(editor.fillColor)} title="Добавить заливку в палитру" aria-label="Добавить цвет заливки в палитру"><Icon name="plus" size={16} /></button>
        {/if}
      </div>
      <button
        class="swap"
        onclick={() => editor.swapColors()}
        title="Поменять контур и заливку местами (X)"
        aria-label="Поменять контур и заливку местами"
      >⇄</button>
    {/if}
  </div>

  {#if section === 'saved'}
    <div class="saved" role="group" aria-label="Сохранённые палитры">
      <button class="tile add-tile" onclick={savePalette} title="Сохранить текущую палитру" aria-label="Сохранить текущую палитру">
        <Icon name="plus" size={18} />
      </button>
      {#each savedList as p (p.id)}
        <button
          class="tile"
          class:active={preview?.id === p.id}
          onclick={() => (preview = preview?.id === p.id ? null : p)}
          title="{p.name || 'Новая палитра'} ({p.colours.length})"
          aria-label="Палитра {p.name || 'Новая палитра'}, {p.colours.length} цветов"
        >
          {#each p.colours.slice(0, 30) as c, i (i)}
            <span class="micro" style:background={c}></span>
          {/each}
        </button>
      {/each}
    </div>
  {:else}
    <div class="grid" class:remover={removerMode} bind:this={gridEl} role="group" aria-label="Палитра">
      {#each editor.palette as color (color)}
        {@const isOutline = editor.brushColor === color}
        {@const isFill = twoColors && editor.fillColor === color}
        <button
          class="cell"
          data-color={color}
          style:--swatch={color}
          style:color={contrastInk(color)}
          onmousedown={(e) => onCell(e, color)}
          oncontextmenu={(e) => e.preventDefault()}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onCell(new MouseEvent('click', { button: e.shiftKey ? 2 : 0 }), color))}
          title={removerMode ? `Убрать ${color} из палитры` : `${color}: ЛКМ — контур, ПКМ — заливка`}
          aria-label={removerMode ? `Убрать ${color} из палитры` : `Цвет ${color} (Enter — контур, Shift+Enter — заливка)`}
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

  <div class="foot" role="group" aria-label="Инструменты палитры">
    <button
      class="foot-btn"
      class:active={section === 'edit'}
      aria-pressed={section === 'edit'}
      onclick={() => openSection('edit')}
      title="Редактировать палитру"
      aria-label="Редактировать палитру"
    ><Icon name="edit" size={18} /></button>
    {#if section === 'edit'}
      <button
        class="foot-btn"
        class:active={removerMode}
        aria-pressed={removerMode}
        onclick={toggleRemover}
        title="Удалить цвета: щёлкай по ним в палитре"
        aria-label="Режим удаления цветов"
      ><Icon name="x" size={18} /></button>
      <button class="foot-btn danger" onclick={erasePalette} title="Очистить палитру" aria-label="Очистить палитру"><Icon name="trash" size={18} /></button>
    {:else}
      <button
        class="foot-btn"
        class:active={section === 'saved'}
        aria-pressed={section === 'saved'}
        onclick={() => openSection('saved')}
        title="Сохранённые палитры"
        aria-label="Сохранённые палитры"
      ><Icon name="palette" size={18} /></button>
      <button
        class="foot-btn"
        class:active={editor.tool === 'pipette'}
        aria-pressed={editor.tool === 'pipette'}
        onclick={() => editor.selectTool('pipette')}
        oncontextmenu={(e) => (e.preventDefault(), editor.selectTool('pipette', 'fill'))}
        title="Пипетка (P); ПКМ — в заливку"
        aria-label="Пипетка; правая кнопка берёт цвет в заливку"
      ><Icon name="pipette" size={18} /></button>
    {/if}
  </div>
</div>

<!-- Reference PalettePreview: the saved palette opened beside the box. -->
{#if preview}
  <div class="box preview" role="dialog" aria-label="Палитра {preview.name || 'Новая палитра'}">
    <div class="preview-head">
      <strong>{preview.name || 'Новая палитра'}</strong>
      <button class="close" onclick={() => (preview = null)} aria-label="Закрыть">✕</button>
    </div>
    <div class="grid preview-grid" role="group" aria-label="Цвета палитры">
      {#each preview.colours as c, i (i)}
        <button
          class="cell"
          style:--swatch={c}
          style:color={contrastInk(c)}
          onmousedown={(e) => onPreviewCell(e, c)}
          oncontextmenu={(e) => e.preventDefault()}
          title="{c}: ЛКМ — контур, ПКМ — заливка"
          aria-label="Взять цвет {c}"
        ></button>
      {/each}
    </div>
    <div class="foot">
      <button class="foot-btn" onclick={() => preview && usePalette(preview)} title="Загрузить палитру" aria-label="Загрузить палитру"><Icon name="palette" size={18} /></button>
      <button class="foot-btn" onclick={() => preview && mergePalette(preview)} title="Объединить с текущей палитрой" aria-label="Объединить с текущей палитрой"><Icon name="plus" size={18} /></button>
      {#if preview.id >= 0}
        <button class="foot-btn danger" onclick={() => preview && deletePalette(preview)} title="Удалить палитру" aria-label="Удалить палитру"><Icon name="trash" size={18} /></button>
      {/if}
    </div>
  </div>
{/if}

{#if picking}
  <ColourPicker
    color={picking.target === 'fill' ? editor.fillColor : editor.brushColor}
    label={picking.target === 'fill' ? 'заливка' : 'контур'}
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
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    background: var(--canvas);
    box-shadow: 0 8px 12px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }
  .palette {
    display: grid;
    grid-template-rows: auto minmax(32px, 1fr) 40px;
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
  .face:focus-visible {
    outline: 3px solid var(--electric);
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
  /* «Add to palette», bottom-left, only while the color is not in the grid. */
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
  .swap {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--hairline);
    border-radius: 50%;
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    transform: translate(-50%, -50%);
    cursor: pointer;
  }
  .add:focus-visible,
  .swap:focus-visible,
  .close:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  /* The reference grid: 35px cells edge to edge, no gaps. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(35px, 1fr));
    max-height: 120px;
    overflow: auto;
    background: var(--sky);
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
    outline: 3px solid var(--electric);
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
    background: var(--sky);
  }
  .tile {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    grid-template-rows: repeat(5, 1fr);
    min-height: 60px;
    padding: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    overflow: hidden;
    cursor: pointer;
  }
  .tile.active {
    outline: 2px solid var(--electric);
  }
  .tile:focus-visible {
    outline: 3px solid var(--electric);
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
    min-height: 40px;
    border-top: 1px solid var(--hairline);
  }
  .foot-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    border: none;
    background: var(--canvas);
    color: var(--ink-2);
    cursor: pointer;
  }
  .foot-btn + .foot-btn {
    border-left: 1px solid var(--hairline);
  }
  .foot-btn:hover {
    background: var(--sky);
  }
  .foot-btn.active {
    background: var(--ghost-2);
    color: var(--electric);
  }
  .foot-btn.danger {
    color: var(--signal-dark);
  }
  .foot-btn:focus-visible {
    outline: 3px solid var(--electric);
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
    padding: 0.1rem 0.4rem;
    border: none;
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    cursor: pointer;
  }
</style>
