<script lang="ts">
  /**
   * The bucket's own box, under its key pressed again (owner, 2026-10-16: the
   * brush's box came up there): where the borders are looked for, and how
   * wide a break in a line still holds the fill. The settings sheet keeps the
   * gap too, as the other way to it.
   */
  import type { EditorState } from './editor-state.svelte';
  import { FILL_GAP_MAX, type FillSource } from './presets';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  const SOURCES: readonly [FillSource, string][] = [
    ['layer', t('fill.layer')],
    ['canvas', t('fill.canvas')],
  ];

  function setGap(value: number): void {
    if (Number.isFinite(value)) {
      editor.setSetting('fillGap', Math.min(FILL_GAP_MAX, Math.max(0, Math.round(value))));
    }
  }
</script>

<div class="fill-box" role="group" aria-label={t('fill.box')}>
  <!-- Still being shaped (owner, 2026-10-16): it says so where it is set up. -->
  <p class="beta">{t('fill.experimental')}</p>
  <h2 id="fill-source">{t('fill.source')}</h2>
  <div class="choice" role="group" aria-labelledby="fill-source">
    {#each SOURCES as [id, label] (id)}
      <button
        type="button"
        class:active={editor.settings.fillSource === id}
        aria-pressed={editor.settings.fillSource === id}
        onclick={() => editor.setSetting('fillSource', id)}
      >{label}</button>
    {/each}
  </div>
  <h2>{t('fill.gap')}</h2>
  <input
    type="range"
    min="0"
    max={FILL_GAP_MAX}
    value={editor.settings.fillGap}
    aria-label={t('fill.gap')}
    aria-valuetext={t('settings.fill_gap_value', { n: editor.settings.fillGap })}
    oninput={(e) => setGap(e.currentTarget.valueAsNumber)}
  />
  <input
    type="number"
    inputmode="numeric"
    min="0"
    max={FILL_GAP_MAX}
    value={editor.settings.fillGap}
    aria-label={t('fill.gap_number')}
    onchange={(e) => {
      setGap(e.currentTarget.valueAsNumber);
      e.currentTarget.value = String(editor.settings.fillGap);
    }}
  />
  <p class="hint">{t('settings.fill_gap_hint')}</p>
  <!-- Every line is a border, and a place painted over with a thick brush is
       all lines: an outline drawn on top of it has nothing empty inside to
       pour into (owner, 2026-10-16). -->
  <p class="warn">{t('fill.lines_warning')}</p>
</div>

<style>
  /* The brush box's frame (BrushPanel): the same width, the same grid. Not
     `.box`: a column stretches those to its width (Editor.svelte), and in a
     pop the long warning then widened the plate across the studio. */
  .fill-box {
    width: 225px;
    max-width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(44px, 1fr);
    gap: 10px;
    align-items: center;
    padding: 10px;
    border-radius: var(--r-md);
    background: var(--canvas);
    overflow: auto;
  }
  h2,
  .choice,
  .hint,
  .warn,
  .beta {
    grid-column: 1 / 3;
    margin: 0;
  }
  h2 {
    text-align: center;
    font-size: 1rem;
    font-weight: 400;
    color: var(--ink-2);
  }
  .choice {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 3px;
    border-radius: var(--r-sm);
    background: var(--sub);
  }
  .choice button {
    min-height: var(--key-h, 2.75rem);
    padding: 0 6px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 0.86rem;
    cursor: pointer;
  }
  .choice button.active {
    background: var(--canvas);
    color: var(--accent);
  }
  .choice button:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .hint {
    font-size: 0.8rem;
    color: var(--ink-2);
  }
  .beta {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--accent);
  }
  .warn {
    padding: 8px;
    border-radius: var(--r-sm);
    background: var(--sub);
    font-size: 0.8rem;
    color: var(--ink);
  }
  /* The brush box's track and number, a finger deep (DESIGN §5). */
  input[type='range'] {
    width: 100%;
    height: var(--key-h, 2.75rem);
    margin: 0;
  }
  input[type='number'] {
    width: 100%;
    min-height: var(--key-h, 2.75rem);
    box-sizing: border-box;
    padding: 0 0.2rem;
    border: 1px solid var(--edge);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
