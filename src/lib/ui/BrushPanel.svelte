<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { BRUSH_SIZES_LOGICAL } from '../format/constants';
  import PaletteBox from './PaletteBox.svelte';

  let { editor }: { editor: EditorState } = $props();

  const quickPalette = $derived(editor.paletteExpanded ? null : editor.ux.quickPalette);
  const studio = $derived(editor.ux.layout === 'studio');
  const twoColors = $derived(editor.ux.tools.includes('feather'));
</script>

<!-- Studio (toonio.ru): the palette box — outline and fill as two big swatches
     with the swap between them, the saved grid under, a tool strip at the
     foot — and the brush box with the width and smoothing sliders. -->
{#snippet colorGrid()}
  <div class="grid" role="group" aria-label="Палитра">
    {#each editor.palette as color (color)}
      <button
        class="cell"
        class:active={editor.brushColor === color && editor.tool !== 'eraser'}
        aria-pressed={editor.brushColor === color && editor.tool !== 'eraser'}
        style:--swatch={color}
        onclick={() => editor.setBrushColor(color)}
        title="Цвет {color}"
        aria-label="Цвет {color}"
      ></button>
    {/each}
  </div>
{/snippet}

{#snippet slider(label: string, min: number, max: number, value: number, set: (v: number) => void)}
  <input
    type="range"
    {min}
    {max}
    {value}
    aria-label={label}
    oninput={(e) => set(e.currentTarget.valueAsNumber)}
  />
  <input
    type="number"
    {min}
    {max}
    {value}
    aria-label={label}
    onchange={(e) => set(e.currentTarget.valueAsNumber)}
  />
{/snippet}

{#if studio}
  {#if editor.features.color}
    <PaletteBox {editor} />
  {/if}
  {#if editor.features.sizes}
    <div class="box brush-box" aria-label="Кисть">
      <h3>Толщина</h3>
      {@render slider('Толщина кисти', 1, editor.ux.brushSizeMax, editor.brushSizeLogical, (v) => (editor.brushSizeLogical = v))}
      <h3>Сглаживание</h3>
      {@render slider('Минимальное расстояние между точками', 0, 30, editor.tonioMinDistance, (v) => editor.setTonioMinDistance(v))}
      {@render slider('Общее сглаживание', 1, 100, editor.tonioSmooth, (v) => editor.setTonioSmooth(v))}
    </div>
  {/if}
{:else}
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
          title="Толщина {size} px"
          aria-label="Толщина кисти {size} px"
        >
          <span class="dot" style:width="{Math.min(size + 2, 22)}px" style:height="{Math.min(size + 2, 22)}px"></span>
        </button>
      {/each}
    </div>
    <span class="size" title="Толщина кисти — меняется на +/−">{editor.brushSizeLogical}px</span>
  {/if}
{/if}
{#if editor.oldschool}
  <span class="old" title="Старая кисть — набери o, l, d ещё раз, чтобы вернуться">old</span>
{/if}

{#if !studio}
  {#if editor.features.color && quickPalette}
    <div class="quick" role="group" aria-label="Цвет (M — вся палитра)">
      {#each quickPalette as color (color)}
        <button
          class="swatch"
          class:active={editor.brushColor === color && editor.tool !== 'eraser'}
          aria-pressed={editor.brushColor === color && editor.tool !== 'eraser'}
          style:--swatch={color}
          onclick={() => editor.setBrushColor(color)}
          title="Цвет {color} (M — вся палитра)"
          aria-label="Цвет {color}"
        ></button>
      {/each}
    </div>
  {:else if editor.features.color && editor.paletteExpanded}
    <label class="color" title="Цвет кисти (M — скрыть палитру)" style:--swatch={editor.brushColor}>
      <input
        type="color"
        value={editor.brushColor}
        oninput={(e) => editor.setBrushColor(e.currentTarget.value)}
      />
    </label>
    {#if twoColors}
      <label class="color fill" title="Цвет заливки пера (ПКМ пипеткой)" style:--swatch={editor.fillColor}>
        <input
          type="color"
          value={editor.fillColor}
          oninput={(e) => (editor.fillColor = e.currentTarget.value.toLowerCase())}
        />
      </label>
      <button
        class="key icon"
        onclick={() => editor.swapColors()}
        title="Поменять контур и заливку местами (X)"
        aria-label="Поменять контур и заливку местами"
      >⇄</button>
    {/if}
    {#if editor.ux.colorGrid}
      <button
        class="key icon"
        onclick={() => editor.addCurrentColorToPalette()}
        title="Добавить текущий цвет в палитру"
        aria-label="Добавить текущий цвет в палитру"
      >+</button>
      {@render colorGrid()}
    {/if}
  {/if}
{/if}

<style>
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
    width: var(--key-h);
    height: var(--key-h);
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
  /* Five black dots differing only in diameter are not a selection state —
     the picked one inverts to a filled electric key with a white dot. */
  .size-btn.active {
    background: var(--electric);
    border-color: var(--electric);
  }
  .size-btn.active .dot {
    background: var(--canvas);
    box-shadow: 0 0 0 1px var(--electric);
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
  /* Easter-egg badge: the oldschool pen is on. */
  .old {
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: var(--signal);
    color: var(--canvas);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
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
    box-shadow: 0 0 0 1px var(--hairline);
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
  /* Saved color grid (Tonio): a scrolling strip of 24px cells — the WCAG 2.2
     target floor — so thirty swatches never push the toolbar onto a new row. */
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
    width: 24px;
    height: 24px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--r-sm);
    background: var(--swatch);
    box-shadow: 0 0 0 1px var(--hairline);
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

  /* ---- Studio boxes (reference `.draw .panel`: 225px, rounded, window tone) ---- */
  .box {
    width: 225px;
    max-width: 100%;
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    background: var(--canvas);
    box-shadow: 0 8px 12px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }
  /* Which swatch is which: the icon sits bottom-right in white with a dark
     halo, so it reads on any color. */
  /* The reference grid: 35px cells edge to edge, no gaps. */
  .brush-box {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 10px;
    align-items: center;
    padding: 10px;
  }
  .brush-box h3 {
    grid-column: 1 / 3;
    margin: 0;
    text-align: center;
    font-size: 1rem;
    font-weight: 400;
    color: var(--ink-2);
  }
  .brush-box input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--electric);
  }
  .brush-box input[type='number'] {
    width: 100%;
    min-height: 2rem;
    box-sizing: border-box;
    padding: 0 0.2rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .brush-box input:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .size-btn,
    .swatch {
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .swatch:hover {
      transform: none;
    }
  }
  /* Phone: the row has to hold ten 44px targets on a 390px screen, so the
     parts that only repeat what is already visible give way — the readout
     (the picked dot states the thickness) and the divider — and the gaps
     tighten. */
  @media (max-width: 40rem) {
    .sizes {
      gap: 0.15rem;
    }
    .size,
    .sep {
      display: none;
    }
  }
</style>
