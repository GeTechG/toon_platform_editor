<script lang="ts">
  import { tick } from 'svelte';
  import type { EditorState, Tool } from './editor-state.svelte';
  import {
    TONIO_DEFAULT_PALETTE,
    contrastInk,
    gridScrollDelta,
    gridStep,
    mergePalettes,
    pressesCell,
    type SavedPalette,
  } from './color-palette';
  import Icon from './Icon.svelte';
  import ColourPicker from './ColourPicker.svelte';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  // Reference Palette sections: the grid (0), the saved list (1), edit mode (2).
  let section = $state<'colors' | 'saved' | 'edit'>('colors');
  let removerMode = $state(false);
  let preview = $state<SavedPalette | null>(null);
  /** Which big swatch the picker is open for, where it opened, and from what colour and tool. */
  let picking = $state<{ target: 'outline' | 'fill'; x: number; y: number; origin: string; tool: Tool } | null>(null);
  /** The grid, for scrolling the chosen outline into view. */
  let gridEl = $state<HTMLElement | null>(null);
  /** The grid is one Tab stop: the cell focus last stood on, else the outline. */
  let rove = $state(-1);
  let boxEl = $state<HTMLElement | null>(null);
  const stop = $derived(
    rove >= 0 && rove < editor.palette.length ? rove : Math.max(0, editor.palette.indexOf(editor.brushColor)),
  );
  /** The preview's grid is one Tab stop too — a saved palette holds up to 300 colours. */
  let previewRove = $state(0);
  const previewStop = $derived(preview && previewRove < preview.colours.length ? previewRove : 0);
  /** What went down on a cell last: a mouse presses it then, a pen or a finger on release. */
  let pointerKind = 'mouse';

  const outlineInGrid = $derived(editor.palette.includes(editor.brushColor));
  const fillInGrid = $derived(editor.palette.includes(editor.fillColor));
  const DEFAULT: SavedPalette = { id: -1, name: t('palette.default_name'), created: 0, colours: [...TONIO_DEFAULT_PALETTE] };
  const savedList = $derived([DEFAULT, ...editor.savedPalettes].reverse());

  /** Left button (or keyboard) → outline, right button → fill; remover mode deletes instead. */
  function onCell(e: MouseEvent, color: string): void {
    if (e.button !== 0 && e.button !== 2) return;
    if (removerMode) {
      const at = editor.palette.indexOf(color);
      const hadFocus = gridEl?.contains(document.activeElement) ?? false;
      editor.removePaletteColor(color);
      if (hadFocus) refocusCell(at);
      return;
    }
    editor.pickColor(color, e.button === 2 ? 'fill' : 'outline', true);
  }

  /** The removed cell took focus with it; the one that slid into its place gets it. */
  async function refocusCell(at: number): Promise<void> {
    await tick();
    const cells = gridEl?.querySelectorAll<HTMLElement>('.cell');
    if (!cells?.length) return focusFoot('remover');
    rove = Math.min(at, cells.length - 1);
    cells[rove].focus();
  }

  /**
   * Erase, load, merge and delete each take away the key that was pressed
   * (the edit strip folds, the preview closes); focus lands on the foot key
   * that is still there instead of falling to the page.
   */
  async function focusFoot(key: 'edit' | 'saved' | 'remover'): Promise<void> {
    await tick();
    boxEl?.querySelector<HTMLElement>(`.foot-btn[data-key="${key}"]`)?.focus();
  }

  /** A tile opens its palette, or closes the one it opened; another palette starts Tab at its first colour. */
  function openPreview(p: SavedPalette): void {
    if (preview?.id !== p.id) previewRove = 0;
    preview = preview?.id === p.id ? null : p;
  }

  /** The preview's own ×: focus goes back to the tile that opened it, not to the page. */
  async function closePreview(): Promise<void> {
    const id = preview?.id;
    preview = null;
    await tick();
    document.querySelector<HTMLElement>(`.saved [data-id="${id}"]`)?.focus();
  }

  function openSection(next: 'colors' | 'saved' | 'edit'): void {
    section = section === next && next !== 'colors' ? 'colors' : next;
    removerMode = false;
    preview = null;
  }

  function savePalette(): void {
    const name = prompt(t('palette.save_prompt'), t('palette.new_name'))?.trim();
    // Storage full or blocked: said now, not found out after a reload.
    if (name && !editor.saveCurrentPalette(name)) alert(t('palette.not_stored'));
  }

  function usePalette(p: SavedPalette): void {
    if (!confirm(t('palette.replace_confirm'))) return;
    editor.replacePalette(p.colours);
    preview = null;
    section = 'colors';
    focusFoot('saved');
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
    focusFoot('saved');
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
    focusFoot('saved');
  }

  function erasePalette(): void {
    if (!confirm(t('palette.erase_confirm'))) return;
    editor.replacePalette([]);
    openSection('colors');
    focusFoot('edit');
  }

  /** The big swatch opens the picker under itself, clamped to the window. */
  function openPicker(e: MouseEvent, target: 'outline' | 'fill'): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picking = {
      target,
      x: Math.max(6, Math.min(r.left, window.innerWidth - 212)),
      y: Math.max(6, Math.min(r.bottom + 6, window.innerHeight - 392)),
      origin: target === 'fill' ? editor.fillColor : editor.brushColor,
      tool: editor.tool,
    };
  }

  /**
   * The picker applies live without touching the grid. Esc asks for the colour
   * it opened on back; any other way out keeps what is chosen, and that colour
   * joins the grid under the reference's `paletteAutoAdd` — if the window
   * changed it. Opened and closed as it was, it adds nothing: at the limit
   * each such glance overwrote the next cell of the ring. The tool is handed
   * back, not picked afresh: a pipette picked again opened the browser
   * eyedropper once more and aimed it at the outline.
   */
  function closePicker(options?: { revert?: boolean }): void {
    if (!picking) return;
    const { target, origin, tool } = picking;
    const current = target === 'fill' ? editor.fillColor : editor.brushColor;
    // Esc is «as it was»: with nothing changed it touches nothing — a pick of
    // the same colour still took the eraser away — and after a change the
    // tool the pick swapped out comes back with the colour.
    if (options?.revert) {
      if (current !== origin) editor.pickColor(origin, target, true);
      if (editor.tool !== tool) editor.restoreTool(tool);
    } else if (current !== origin && editor.ux.colorGrid && editor.settings.paletteAutoAdd) {
      editor.addColorToPalette(current);
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
    const next = walkGrid(e, i);
    if (next !== null) rove = next;
  }

  /** The arrows, Home and End move focus inside the cell's own grid; the new index, or null. */
  function walkGrid(e: KeyboardEvent, i: number): number | null {
    const grid = (e.currentTarget as HTMLElement).parentElement;
    const cells = grid?.querySelectorAll<HTMLElement>('.cell');
    if (!grid || !cells) return null;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const next = gridStep(i, e.key, cells.length, cols);
    if (next === null) return null;
    e.preventDefault();
    cells[next].focus();
    return next;
  }

  /**
   * A finger and a pen tip have no right button: their long press is the
   * `contextmenu` the mouse's right button also sends — that one already
   * pressed the cell on `mousedown`, so it only loses its menu. A pen or a
   * finger presses on release (`pressesCell`), so the release after a long
   * press is told it is not theirs: the fill must not land on the outline too.
   */
  function longPress(e: MouseEvent, press: () => void): void {
    e.preventDefault();
    if ((e as PointerEvent).pointerType === 'mouse' || !(e as PointerEvent).pointerType) return;
    holdEnd();
    // The grid's own timer already took this hold: one press, one fill — in
    // remover mode a second one took the cell that slid into its place.
    if (held) return;
    held = true;
    press();
    pointerKind = 'held';
  }

  /**
   * Safari on iOS sends no `contextmenu` for a long press, so on an iPhone or
   * an iPad the grid gave the fill to nobody. The grid times the hold itself;
   * where the menu does come (Android, a pen), whichever of the two is first
   * presses and the other finds `held`. A finger that wanders is scrolling.
   */
  const HOLD_MS = 500;
  const HOLD_SLOP = 10;
  let hold: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  /** This press has already been taken as a long one. */
  let held = false;

  function holdStart(
    e: PointerEvent,
    press: (color: string) => void,
    color = (e.target as HTMLElement).closest<HTMLElement>('.cell')?.dataset.color,
  ): void {
    held = false;
    holdEnd();
    if (e.pointerType === 'mouse' || !e.isPrimary || !color) return;
    const timer = setTimeout(() => {
      hold = null;
      held = true;
      // The release that ends the hold is not a press of its own.
      pointerKind = 'held';
      press(color);
    }, HOLD_MS);
    hold = { id: e.pointerId, x: e.clientX, y: e.clientY, timer };
  }

  function holdMove(e: PointerEvent): void {
    if (hold?.id === e.pointerId && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP) holdEnd();
  }

  function holdEnd(): void {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  }

  $effect(() => holdEnd);

  /** The pipette key's right button is a long press too: on an iPhone, the only way to pipette into the fill. */
  function pipetteHold(e: PointerEvent): void {
    holdStart(e, () => editor.selectTool('pipette', 'fill'), 'fill');
  }

  /* Reference `bundle:7783`: the grid follows the chosen outline — the grid
     alone, not the rail or the tab window it stands in. */
  $effect(() => {
    const cell = gridEl?.querySelector(`[data-color="${editor.brushColor}"]`);
    if (!gridEl || !cell) return;
    const g = gridEl.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    gridEl.scrollTop += gridScrollDelta(g.top, g.bottom, c.top, c.bottom);
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
<div class="box palette" role="group" aria-label={t('palette.box')} bind:this={boxEl}>
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
      title={editor.keyHint(t('color.swap_title'))}
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
          data-id={p.id}
          class:active={preview?.id === p.id}
          aria-expanded={preview?.id === p.id}
          onclick={() => openPreview(p)}
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
    <div class="grid" class:remover={removerMode} bind:this={gridEl} role="group" aria-label={t('palette.grid')}
      onpointerdown={(e) => holdStart(e, (color) => onCell(new MouseEvent('click', { button: 2 }), color))}
      onpointermove={holdMove}
      onpointerup={holdEnd}
      onpointercancel={holdEnd}
    >
      {#each editor.palette as color, i (color)}
        {@const isOutline = editor.brushColor === color}
        {@const isFill = editor.fillColor === color}
        <button
          class="cell"
          data-color={color}
          style:--swatch={color}
          style:color={contrastInk(color)}
          onpointerdown={(e) => (pointerKind = e.pointerType)}
          onmousedown={(e) => pressesCell('mousedown', pointerKind, e.detail) && onCell(e, color)}
          onclick={(e) => pressesCell('click', pointerKind, e.detail) && onCell(e, color)}
          oncontextmenu={(e) => longPress(e, () => onCell(new MouseEvent('click', { button: 2 }), color))}
          tabindex={i === stop ? 0 : -1}
          onfocus={() => (rove = i)}
          onkeydown={(e) => onCellKey(e, i, color)}
          title={removerMode ? t('palette.remove_colour', { color }) : t('palette.colour_title', { color })}
          aria-label={removerMode
            ? t('palette.remove_colour', { color })
            : t('palette.colour', {
                color,
                role: isOutline && isFill
                  ? ` — ${t('palette.is_both')}`
                  : isOutline
                    ? ` — ${t('palette.is_stroke')}`
                    : isFill
                      ? ` — ${t('palette.is_fill')}`
                      : '',
              })}
          aria-pressed={removerMode ? undefined : isOutline || isFill}
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
      {#if editor.palette.length === 0}
        <p class="empty">{t('palette.empty')}</p>
      {/if}
    </div>
  {/if}

  <div class="foot" role="group" aria-label={t('palette.tools')}>
    <button
      class="foot-btn"
      data-key="edit"
      class:active={section === 'edit'}
      aria-pressed={section === 'edit'}
      onclick={() => openSection('edit')}
      title={t('palette.edit')}
      aria-label={t('palette.edit')}
    ><Icon name="edit" size={18} /></button>
    {#if section === 'edit'}
      <button
        class="foot-btn"
        data-key="remover"
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
        data-key="saved"
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
        onpointerdown={pipetteHold}
        onpointermove={holdMove}
        onpointerup={holdEnd}
        onpointercancel={holdEnd}
        onclick={(e) => {
          // The release that ended a long press is not a second press; a key always is.
          if (held && e.detail !== 0) return;
          editor.selectTool('pipette');
        }}
        oncontextmenu={(e) => {
          e.preventDefault();
          // Android sends the menu as well as the timer running out: one fill.
          holdEnd();
          if (!held) editor.selectTool('pipette', 'fill');
          held = true;
        }}
        onkeydown={(e) => {
          // The keys' right button, as on a palette cell.
          if (e.key === 'Enter' && e.shiftKey) (e.preventDefault(), editor.selectTool('pipette', 'fill'));
        }}
        title={editor.keyHint(t('palette.pipette_title'))}
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
      <button class="close" onclick={closePreview} aria-label={t('picker.close')}><Icon name="x" size={16} /></button>
    </div>
    <div class="grid preview-grid" role="group" aria-label={t('palette.preview_colours')}
      onpointerdown={(e) => holdStart(e, (color) => onPreviewCell(new MouseEvent('click', { button: 2 }), color))}
      onpointermove={holdMove}
      onpointerup={holdEnd}
      onpointercancel={holdEnd}
    >
      {#each preview.colours as c, i (i)}
        <button
          class="cell"
          data-color={c}
          style:--swatch={c}
          style:color={contrastInk(c)}
          onpointerdown={(e) => (pointerKind = e.pointerType)}
          onmousedown={(e) => pressesCell('mousedown', pointerKind, e.detail) && onPreviewCell(e, c)}
          onclick={(e) => pressesCell('click', pointerKind, e.detail) && onPreviewCell(e, c)}
          oncontextmenu={(e) => longPress(e, () => onPreviewCell(new MouseEvent('click', { button: 2 }), c))}
          tabindex={i === previewStop ? 0 : -1}
          onfocus={() => (previewRove = i)}
          onkeydown={(e) => {
            // A key fires `click`, never `mousedown`: the same press as the grid's.
            if (e.key !== 'Enter' && e.key !== ' ') {
              const next = walkGrid(e, i);
              if (next !== null) previewRove = next;
              return;
            }
            e.preventDefault();
            onPreviewCell(new MouseEvent('click', { button: e.shiftKey ? 2 : 0 }), c);
          }}
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
    /* The 16px glyph (in rem, it grows with the text) and 8px round it: 24 at
       100 %, 40 at 200 % — still clear of the mark in the other corner. */
    width: calc(1rem + 8px);
    height: calc(1rem + 8px);
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
    /* The glyph and a 6px ring of disc: 28 at 100 %, 44 at 200 % — at a fixed
       28 the 32px arrows of 200 % text spilled out of their disc. */
    width: calc(1rem + 12px);
    height: calc(1rem + 12px);
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--sub);
    color: var(--ink);
    font: inherit;
    transform: translate(-50%, -50%);
    cursor: pointer;
  }
  /* «Add» sits on its swatch and swap on the seam of two: an accent ring there
     was red on a red swatch. «Add» takes the swatch's contrast ink, like the
     face; swap rings inside its own grey disc, clear of both swatches. */
  .add:focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 0;
  }
  .swap:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
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
  .empty {
    grid-column: 1 / -1;
    margin: 0;
    padding: 0.5rem;
    color: var(--ink-2);
    font-size: 0.8rem;
  }
  .cell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 2rem;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--swatch);
    cursor: pointer;
    /* A long press is the fill: no callout or selection over it on iOS. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  /* The dense grid is for the mouse (DESIGN §5). Under a finger — the colour
     tab of a phone above all — the cells take the studio's key, and the grid
     fewer to a row: 32px at 100 % text was a finger's width short. */
  @media (pointer: coarse) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(var(--key-h, 2.75rem), 1fr));
    }
    .cell {
      height: var(--key-h, 2.75rem);
    }
  }
  .cell:focus-visible {
    outline: 3px solid currentColor;
    outline-offset: -3px;
  }
  .grid.remover .cell {
    cursor: not-allowed;
  }
  /* Hidden only where a pointer hovers: on a touch screen the mark stays on
     every cell, or remove mode would say nothing about what a tap takes. */
  @media (hover: hover) {
    .grid.remover .cell :global(svg) {
      opacity: 0;
    }
    .grid.remover .cell:hover :global(svg) {
      opacity: 1;
    }
  }
  .grid.remover .cell:focus-visible :global(svg) {
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
  /* Off the tile, so focus walking the list does not look like another open one. */
  .tile:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
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
    /* The pipette's long press is the fill: no callout over it on iOS. */
    -webkit-touch-callout: none;
  }
  .foot-btn + .foot-btn {
    border-left: 1px solid var(--hairline);
  }
  @media (hover: hover) {
    .foot-btn:hover {
      background: var(--sub);
    }
  }
  .foot-btn.active {
    background: color-mix(in srgb, var(--accent) 14%, var(--canvas));
    color: var(--accent-ink);
  }
  /* Safari 16.0 and 16.1 have no color-mix(): the pressed key kept white. */
  @supports not (color: color-mix(in srgb, red, red)) {
    .foot-btn.active {
      background: var(--sub);
    }
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
