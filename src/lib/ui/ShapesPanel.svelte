<script lang="ts">
  /**
   * The shapes tool's own box, under its key pressed again, as the bucket's
   * and the magnet's are: which shape, how many sides a polygon has, outline
   * or filled — and the thickness, which is the pencil's: a shape is laid
   * with the brush in use (owner, 2026-11-16: «текущей толщиной»).
   */
  import type { EditorState } from './editor-state.svelte';
  import { clampSides, POLYGON_MAX_SIDES, POLYGON_MIN_SIDES, type ShapeKind } from '../tools/shapes';
  import { SIZE_TRACK, positionOfSize, sizeAtPosition } from './size-scale';
  import Icon, { type IconName } from './Icon.svelte';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  const KINDS: readonly [ShapeKind, IconName][] = [
    ['line', 'shape-line'],
    ['rect', 'shape-rect'],
    ['ellipse', 'shape-ellipse'],
    ['polygon', 'shape-polygon'],
  ];
  const kind = $derived(editor.settings.shapeKind);
  const size = $derived(editor.brushSizeLogical);
  const range = $derived(editor.brushRange);
</script>

<div class="shapes-box" role="group" aria-label={t('shapes.box')}>
  <h2 id="shapes-kind">{t('shapes.kind')}</h2>
  <div class="choice kinds" role="group" aria-labelledby="shapes-kind">
    {#each KINDS as [id, icon] (id)}
      <button
        type="button"
        class:active={kind === id}
        aria-pressed={kind === id}
        aria-label={t(`shapes.${id}`)}
        title={t(`shapes.${id}`)}
        onclick={() => editor.setSetting('shapeKind', id)}
      ><Icon name={icon} /></button>
    {/each}
  </div>
  {#if kind === 'polygon'}
    <label class="sides" for="shapes-sides">{t('shapes.sides')}</label>
    <input
      id="shapes-sides"
      type="number"
      inputmode="numeric"
      min={POLYGON_MIN_SIDES}
      max={POLYGON_MAX_SIDES}
      value={editor.settings.shapeSides}
      onchange={(e) => {
        if (Number.isFinite(e.currentTarget.valueAsNumber)) {
          editor.setSetting('shapeSides', clampSides(e.currentTarget.valueAsNumber));
        }
        e.currentTarget.value = String(editor.settings.shapeSides);
      }}
    />
  {/if}
  {#if kind !== 'line'}
    <div class="choice" role="group" aria-label={t('shapes.look')}>
      <button
        type="button"
        class:active={!editor.settings.shapeFilled}
        aria-pressed={!editor.settings.shapeFilled}
        onclick={() => editor.setSetting('shapeFilled', false)}
      >{t('shapes.outline')}</button>
      <button
        type="button"
        class:active={editor.settings.shapeFilled}
        aria-pressed={editor.settings.shapeFilled}
        onclick={() => editor.setSetting('shapeFilled', true)}
      >{t('shapes.filled')}</button>
    </div>
  {/if}
  <!-- Alt's stand-in: a finger has no Alt (owner, 2026-11-16). -->
  <label class="check">
    <input
      type="checkbox"
      checked={editor.settings.shapeFromCentre}
      onchange={(e) => editor.setSetting('shapeFromCentre', e.currentTarget.checked)}
    />
    <span>{t('shapes.from_centre')}</span>
  </label>
  <h2>{t('shapes.thickness')}</h2>
  <!-- The brush box's logarithmic track: the thin lines get most of it. -->
  <input
    type="range"
    min="0"
    max={SIZE_TRACK}
    step="any"
    value={Math.round(positionOfSize(size, range.min, editor.brushSizeMax))}
    aria-label={t('shapes.thickness')}
    aria-valuetext={t('shapes.thickness_value', { n: size })}
    oninput={(e) => (editor.brushSizeLogical = sizeAtPosition(e.currentTarget.valueAsNumber, range.min, editor.brushSizeMax))}
    onchange={(e) => (e.currentTarget.value = String(Math.round(positionOfSize(size, range.min, editor.brushSizeMax))))}
  />
  <input
    type="number"
    inputmode="numeric"
    min={range.min}
    max={editor.brushSizeMax}
    value={size}
    aria-label={t('shapes.thickness_number')}
    onchange={(e) => {
      if (Number.isFinite(e.currentTarget.valueAsNumber)) {
        editor.brushSizeLogical = e.currentTarget.valueAsNumber;
      }
      e.currentTarget.value = String(editor.brushSizeLogical);
    }}
  />
</div>

<style>
  /* The bucket's box (FillPanel): the brush box's width and grid. */
  .shapes-box {
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
  .check {
    grid-column: 1 / 3;
    margin: 0;
  }
  h2 {
    text-align: center;
    font-size: 1rem;
    font-weight: 400;
    color: var(--ink-2);
  }
  .sides {
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
  .choice.kinds {
    grid-template-columns: repeat(4, 1fr);
  }
  .choice button {
    display: grid;
    place-items: center;
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
  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--key-h, 2.75rem);
    font-size: 0.86rem;
    color: var(--ink);
    cursor: pointer;
  }
  /* Drawn by the studio's own controls.css, as every checkbox is. */
  .check input {
    flex: none;
    margin: 0;
  }
  .choice button.active {
    background: var(--canvas);
    color: var(--accent);
  }
  .choice button:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
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
</style>
