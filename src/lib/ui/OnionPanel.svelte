<script lang="ts">
  /**
   * The onion's own box, under its key pressed again (owner, 2026-10-18:
   * Procreate Dreams' Onions): the switch, then each side — how many frames,
   * how strongly the nearest shows, the colour it is tinted in — and whether
   * the current frame is laid half through over the ghosts.
   */
  import type { EditorState } from './editor-state.svelte';
  import { ONION_SIDE_MAX_FRAMES } from './frame-selection';
  import { ONION_MIN_OPACITY } from './presets';
  import ColourPicker from './ColourPicker.svelte';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  let sideId = $state<'back' | 'ahead'>('back');
  const side = $derived(editor.settings.onion[sideId]);
  let picking = $state<{ x: number; y: number; origin: string } | null>(null);

  const SIDES: readonly ['back' | 'ahead', string][] = [
    ['back', t('onion.back')],
    ['ahead', t('onion.ahead')],
  ];

  /** Beside the box, not over it: the sliders stay in reach while a colour is picked. */
  function openPicker(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).closest('.onion-box')!.getBoundingClientRect();
    picking = {
      x: Math.max(6, Math.min(r.right + 6, window.innerWidth - 212)),
      y: Math.max(6, Math.min(r.top, window.innerHeight - 392)),
      origin: side.colour,
    };
  }

  function closePicker(options?: { revert?: boolean }): void {
    if (picking && options?.revert) editor.setOnion({ [sideId]: { colour: picking.origin } });
    picking = null;
  }
</script>

<div class="onion-box" role="group" aria-label={t('onion.box')}>
  <label class="switch-row">
    <span>{t('editor.onion')}</span>
    <input
      type="checkbox"
      role="switch"
      checked={editor.onionSkin}
      onchange={() => editor.toggleOnionSkin()}
    />
  </label>
  <div class="choice" role="group" aria-label={t('onion.side')}>
    {#each SIDES as [id, label] (id)}
      <button
        type="button"
        class:active={sideId === id}
        aria-pressed={sideId === id}
        onclick={() => (sideId = id)}
      >{label}</button>
    {/each}
  </div>
  <!-- The name, the track and the number on one row: the window stood over
       the whole sheet on a phone, and the sheet is what it is set by. -->
  <label class="slide">
    <span>{t('onion.frames')}</span>
    <input
      type="range"
      min="0"
      max={ONION_SIDE_MAX_FRAMES}
      value={side.frames}
      oninput={(e) => editor.setOnion({ [sideId]: { frames: e.currentTarget.valueAsNumber } })}
    />
    <output>{side.frames}</output>
  </label>
  <label class="slide">
    <span>{t('onion.opacity')}</span>
    <input
      type="range"
      min={ONION_MIN_OPACITY}
      max="100"
      value={side.opacity}
      aria-valuetext="{side.opacity}%"
      oninput={(e) => editor.setOnion({ [sideId]: { opacity: e.currentTarget.valueAsNumber } })}
    />
    <output>{side.opacity}%</output>
  </label>
  <div class="switch-row">
    <span id="onion-tint">{t('onion.tint')}</span>
    {#if side.tint}
      <button
        type="button"
        class="swatch"
        style:background={side.colour}
        aria-label={t('onion.tint_colour')}
        onclick={openPicker}
      ></button>
    {/if}
    <input
      type="checkbox"
      role="switch"
      aria-labelledby="onion-tint"
      checked={side.tint}
      onchange={(e) => editor.setOnion({ [sideId]: { tint: e.currentTarget.checked } })}
    />
  </div>
  <label class="switch-row">
    <span>{t('onion.blend')}</span>
    <input
      type="checkbox"
      role="switch"
      checked={editor.settings.onion.blend}
      onchange={(e) => editor.setOnion({ blend: e.currentTarget.checked })}
    />
  </label>
</div>

{#if picking}
  <ColourPicker
    color={side.colour}
    label={t('onion.tint_colour')}
    x={picking.x}
    y={picking.y}
    model={editor.settings.pickerModel}
    onmodel={(next) => editor.setSetting('pickerModel', next)}
    onpick={(hex) => editor.setOnion({ [sideId]: { colour: hex } })}
    onclose={closePicker}
  />
{/if}

<style>
  /* The bucket's box (FillPanel) in its tones, packed tighter: a row per
     setting, so on a phone it leaves the sheet in sight. */
  .onion-box {
    width: 16.5rem;
    max-width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 2.6rem;
    gap: 8px 10px;
    align-items: center;
    padding: 10px;
    border-radius: var(--r-md);
    background: var(--canvas);
    /* A phone lying down has less room under the key than the box is tall:
       it scrolls inside the room the key tells (PopKey `--room`). */
    max-height: calc(var(--room, 100dvh) - 2px);
    overflow: auto;
    font-size: 0.86rem;
  }
  .choice,
  .switch-row {
    grid-column: 1 / 4;
  }
  .slide {
    display: contents;
  }
  output {
    font-variant-numeric: tabular-nums;
    text-align: end;
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
    min-height: 2.25rem;
    padding: 0 6px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .choice button.active {
    background: var(--canvas);
    color: var(--accent);
  }
  .choice button:focus-visible,
  .swatch:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* The words wrap, the switch stays at the end of their row: under a long
     name («Смешивать текущий кадр») it hung alone on a line of its own. */
  .switch-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .switch-row span {
    flex: 1;
  }
  .switch-row input,
  .swatch {
    flex: none;
  }
  .swatch {
    width: 2rem;
    height: 1.75rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  input[type='range'] {
    width: 100%;
    margin: 0;
  }
</style>
