<script lang="ts">
  /**
   * The magnet's own box, under its key pressed again, as the bucket's is: how
   * wide its circle is and how much of the cursor's step it passes on. The
   * radius is also Shift+drag on the canvas and + / −, while the magnet is in
   * hand (owner: settings are a gesture in the editor).
   */
  import type { EditorState } from './editor-state.svelte';
  import { MAGNET_RADIUS_MAX, MAGNET_RADIUS_MIN } from './presets';
  import { SIZE_TRACK, positionOfSize, sizeAtPosition } from './size-scale';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  const radius = $derived(editor.settings.magnetRadius);
  const strength = $derived(editor.settings.magnetStrength);
</script>

<div class="magnet-box" role="group" aria-label={t('magnet.box')}>
  <h2>{t('magnet.radius')}</h2>
  <!-- On the brush's logarithmic track: the small circles get most of it. -->
  <input
    type="range"
    min="0"
    max={SIZE_TRACK}
    step="any"
    value={Math.round(positionOfSize(radius, MAGNET_RADIUS_MIN, MAGNET_RADIUS_MAX))}
    aria-label={t('magnet.radius')}
    aria-valuetext={t('magnet.radius_value', { n: radius })}
    oninput={(e) => editor.setMagnetRadius(sizeAtPosition(e.currentTarget.valueAsNumber, MAGNET_RADIUS_MIN, MAGNET_RADIUS_MAX))}
    onchange={(e) => (e.currentTarget.value = String(Math.round(positionOfSize(radius, MAGNET_RADIUS_MIN, MAGNET_RADIUS_MAX))))}
  />
  <input
    type="number"
    inputmode="numeric"
    min={MAGNET_RADIUS_MIN}
    max={MAGNET_RADIUS_MAX}
    value={radius}
    aria-label={t('magnet.radius_number')}
    onchange={(e) => {
      editor.setMagnetRadius(e.currentTarget.valueAsNumber);
      e.currentTarget.value = String(editor.settings.magnetRadius);
    }}
  />
  <h2>{t('magnet.strength')}</h2>
  <input
    type="range"
    min="1"
    max="100"
    value={strength}
    aria-label={t('magnet.strength')}
    aria-valuetext={t('magnet.strength_value', { n: strength })}
    oninput={(e) => editor.setMagnetStrength(e.currentTarget.valueAsNumber)}
  />
  <input
    type="number"
    inputmode="numeric"
    min="1"
    max="100"
    value={strength}
    aria-label={t('magnet.strength_number')}
    onchange={(e) => {
      editor.setMagnetStrength(e.currentTarget.valueAsNumber);
      e.currentTarget.value = String(editor.settings.magnetStrength);
    }}
  />
</div>

<style>
  /* The bucket's box (FillPanel): the brush box's width and grid. */
  .magnet-box {
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
  h2 {
    grid-column: 1 / 3;
    margin: 0;
    text-align: center;
    font-size: 1rem;
    font-weight: 400;
    color: var(--ink-2);
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
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
