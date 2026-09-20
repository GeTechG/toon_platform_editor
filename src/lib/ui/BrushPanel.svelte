<script lang="ts">
  /**
   * The brush box: thickness and smoothing as sliders. The plain row of dots
   * is its own widget (BrushSizes), colour another (ColorPanel/PaletteBox).
   */
  import type { EditorState } from './editor-state.svelte';

  let { editor }: { editor: EditorState } = $props();

</script>

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

<div class="box brush-box" aria-label="Кисть">
  <h3>Толщина</h3>
  {@render slider('Толщина кисти', 1, editor.ux.brushSizeMax, editor.brushSizeLogical, (v) => (editor.brushSizeLogical = v))}
  <h3>Сглаживание</h3>
  {@render slider('Минимальное расстояние между точками', 0, 30, editor.tonioMinDistance, (v) => editor.setTonioMinDistance(v))}
  {@render slider('Общее сглаживание', 1, 100, editor.tonioSmooth, (v) => editor.setTonioSmooth(v))}
</div>
{#if editor.oldschool}
  <span class="old" title="Старая кисть — набери o, l, d ещё раз, чтобы вернуться">old</span>
{/if}

<style>
  .old {
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: var(--signal);
    color: var(--canvas);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .box {
    width: 225px;
    max-width: 100%;
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    background: var(--canvas);
    box-shadow: 0 8px 12px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }
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
</style>
