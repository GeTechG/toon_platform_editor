<script lang="ts">
  import type { EditorState, Tool } from './editor-state.svelte';
  import { BRUSH_SIZES_LOGICAL } from '../format/constants';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  const TOOLS: { id: Tool; icon: IconName; title: string; label: string }[] = [
    { id: 'pencil', icon: 'pencil', title: 'Карандаш (B)', label: 'Карандаш' },
    { id: 'eraser', icon: 'eraser', title: 'Ластик (E)', label: 'Ластик' },
    { id: 'pipette', icon: 'pipette', title: 'Пипетка (P)', label: 'Пипетка' },
  ];

  // Reference (ToolPanel.hx): the pipette only exists once the palette is
  // enabled; the collapsed Multator bar offers just black and red.
  const tools = $derived(
    TOOLS.filter((t) => t.id !== 'pipette' || !editor.ux.pipetteNeedsPalette || editor.paletteExpanded),
  );
  const quickPalette = $derived(editor.paletteExpanded ? null : editor.ux.quickPalette);
</script>

<div class="brush">
  {#if editor.features.tools}
    <div class="tools">
      {#each tools as t (t.id)}
        <!-- `draw` marks the one tool that *is* the "draw" action, so the
             Signal Rule's single red lands on it and nowhere else. -->
        <button
          class="key icon"
          class:active={editor.tool === t.id}
          class:draw={t.id === 'pencil'}
          aria-pressed={editor.tool === t.id}
          onclick={() => editor.selectTool(t.id)}
          title={t.title}
          aria-label={t.label}
        >
          <Icon name={t.icon} />
        </button>
      {/each}
    </div>
  {/if}

  {#if editor.tool === 'pipette'}
    <div class="pick-source" role="group" aria-label="Источник пипетки">
      {#each [['canvas', 'Холст'], ['layer', 'Слой']] as [source, label] (source)}
        <button
          class="key"
          class:active={editor.pickSource === source}
          aria-pressed={editor.pickSource === source}
          onclick={() => editor.setPickSource(source as 'canvas' | 'layer')}
          title={source === 'canvas'
            ? 'Брать цвет с видимого холста (Alt — только активный слой)'
            : 'Брать цвет только с активного слоя'}
        >{label}</button>
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
          title="Толщина {size} px"
          aria-label="Толщина кисти {size} px"
        >
          <span class="dot" style:width="{Math.min(size + 2, 22)}px" style:height="{Math.min(size + 2, 22)}px"></span>
        </button>
      {/each}
    </div>
    <span class="size" title="Толщина кисти — меняется на +/−">{editor.brushSizeLogical}px</span>
  {/if}
  {#if editor.oldschool}
    <span class="old" title="Старая кисть — набери o, l, d ещё раз, чтобы вернуться">old</span>
  {/if}

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
  .pick-source {
    display: flex;
    gap: 4px;
  }
  .pick-source .key {
    padding: 0 10px;
    font-size: 13px;
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
     tighten. That buys the whole brush row a single line. */
  @media (max-width: 40rem) {
    .brush {
      gap: 0.3rem 0.25rem;
      /* Nine 44px targets need 396px and a 390px phone has 374 — rather than
         orphan the last one onto a row of its own, the strip scrolls the last
         few pixels, the way the frame strip does. */
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: 1px;
    }
    .tools,
    .sizes {
      gap: 0.15rem;
    }
    .size,
    .sep {
      display: none;
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
</style>
