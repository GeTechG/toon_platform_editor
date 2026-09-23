<script lang="ts">
  /**
   * The brush box: the type of brush, then thickness and smoothing as
   * sliders. The plain row of dots is its own widget (BrushSizes), colour
   * another (ColorPanel/PaletteBox).
   */
  import { brushOfType, brushTypesFor, hasBrushTypes } from '../plugins/brush-types';
  import { brushPreview, PREVIEW_BOX } from './brush-preview';
  import { SIZE_TRACK, positionOfSize, sizeAtPosition } from './size-scale';
  import { nudgeBrushSize } from './ux-profile';
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import type { EditorState } from './editor-state.svelte';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  /**
   * The types, as the list offers them: the everyday one and whatever the
   * register holds for the tool in hand. What each is called and what it
   * draws comes from its own record, never from a table here.
   */
  const types = $derived(brushTypesFor(editor.tool));

  /**
   * The list is a popover: the box is a narrow column with its own scroll, so
   * anything that opened inside it would be cut off at its edge. In the top
   * layer it is clipped by nothing, and the browser closes it on Escape and
   * on a click elsewhere by itself.
   */
  const listId = $props.id();
  let list = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let picking = $state(false);
  let at = $state({ x: 0, y: 0 });

  /** Under the button, or above it when the bottom of the window is too near. */
  function place(): void {
    if (!list || !trigger) return;
    const anchor = trigger.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    const below = anchor.bottom + 4;
    at = {
      x: Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)),
      y: below + box.height > window.innerHeight - 8
        ? Math.max(8, anchor.top - box.height - 4)
        : below,
    };
  }

  function opened(open: boolean): void {
    picking = open;
    if (!open) return;
    place();
    list?.querySelector<HTMLButtonElement>('.type.active')?.focus();
  }

  /**
   * The sample of one brush, drawn by the engine that draws its real stroke —
   * with the settings as they stand, so the box answers «what do these
   * numbers do» by showing it. A very thick brush would fill the whole
   * sample, so it stops at a width where the shape of the line still reads:
   * 10 draws 80 units across a wave 112 deep; 16 drew 128 and filled it.
   */
  function preview(tool: string) {
    return brushPreview(tool, editor.defaultBrush, Math.min(editor.brushSizeLogical, 10), {
      width: editor.brushSizeLogical,
      smooth: editor.brushSmooth,
      minDistance: editor.brushMinDistance,
    });
  }

  const current = $derived(types.find(({ id }) => id === editor.brushType) ?? types[0]);

  /** Arrows, Home and End walk the list the way a list of choices is walked. */
  function walk(e: KeyboardEvent): void {
    const keys = [...(list?.querySelectorAll<HTMLButtonElement>('.type') ?? [])];
    const from = keys.indexOf(document.activeElement as HTMLButtonElement);
    const next = ({ ArrowDown: from + 1, ArrowUp: from - 1, Home: 0, End: keys.length - 1 } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    keys[(next + keys.length) % keys.length]?.focus();
  }

  /** Which heading's help is open: one at a time, until pressed again, Esc or blur. */
  let openNote = $state<string | null>(null);
</script>

<!-- Thickness runs on a logarithmic track (size-scale.ts): the thin sizes
     everybody draws with get most of it. The track holds positions, so the
     reader hears the size, and a key steps a whole size, as + and − do — at
     the thin end one step of the track would not reach the next whole size. -->
{#snippet slider(label: string, min: number, max: number, value: number, set: (v: number) => void, log = false)}
  {#if log}
    <input
      type="range"
      min="0"
      max={SIZE_TRACK}
      step="any"
      value={Math.round(positionOfSize(value, min, max))}
      aria-label={label}
      aria-valuetext={t('brush.size_value', { count: value })}
      oninput={(e) => set(sizeAtPosition(e.currentTarget.valueAsNumber, min, max))}
      onkeydown={(e) => {
        const next =
          // The arrows step as + and − do, by the preset's own ladder.
          e.key === 'ArrowUp' || e.key === 'ArrowRight' ? nudgeBrushSize(value, 1, editor.ux)
          : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? nudgeBrushSize(value, -1, editor.ux)
          : e.key === 'PageUp' ? Math.max(value + 1, value * 1.25)
          : e.key === 'PageDown' ? Math.min(value - 1, value / 1.25)
          : e.key === 'Home' ? min
          : e.key === 'End' ? max
          : null;
        if (next === null) return;
        e.preventDefault();
        set(Math.min(max, Math.max(min, next)));
      }}
    />
  {:else}
    <input
      type="range"
      {min}
      {max}
      {value}
      aria-label={label}
      oninput={(e) => set(e.currentTarget.valueAsNumber)}
    />
  {/if}
  <input
    type="number"
    {min}
    {max}
    {value}
    aria-label={label}
    onchange={(e) => {
      // An emptied field is NaN, and the brush saved it as `width: null`.
      const v = e.currentTarget.valueAsNumber;
      if (Number.isFinite(v)) set(v);
      // What the brush holds, back in the field: the setter clamps, and a
      // refused or clamped number would otherwise stay on show.
      e.currentTarget.value = String(value);
    }}
  />
{/snippet}

<!-- The words come up over the box when the «i» is pressed — by mouse, finger
     or key alike — and stay until it is pressed again, Esc, or focus moves on.
     Hover used to drive it: the bubble closed under a pointer reaching for
     it, and a finger never opened it (WCAG 1.4.13). The reader gets the same
     words from the button's own label. -->
{#snippet heading(title: string, note: string)}
  <!-- Named by its title: the «i» inside would lend the heading its whole
       label, and a reader walking headings heard the title twice. -->
  <h2 class="field" aria-label={title}>
    {title}
    <button
      class="info"
      type="button"
      aria-label="{title}: {note}"
      onclick={async (e) => {
        openNote = openNote === title ? null : title;
        // The box scrolls, and the words of the last heading opened below
        // its bottom edge, cut off: the box is scrolled to show them.
        const note = e.currentTarget.nextElementSibling;
        await tick();
        if (openNote === title) note?.scrollIntoView({ block: 'nearest' });
      }}
      onkeydown={(e) => {
        if (e.key === 'Escape' && openNote === title) {
          e.preventDefault();
          openNote = null;
        }
      }}
      onblur={() => openNote === title && (openNote = null)}
    ><Icon name="info" /></button>
    <span class="note" class:open={openNote === title} aria-hidden="true">{note}</span>
  </h2>
{/snippet}

{#snippet sample(tool: string)}
  {@const shape = preview(tool)}
  <svg class="sample" viewBox="0 0 {PREVIEW_BOX.width} {PREVIEW_BOX.height}" aria-hidden="true">
    <path
      d={shape.d}
      fill={shape.fill ? 'currentColor' : 'none'}
      stroke={shape.fill ? 'none' : 'currentColor'}
      stroke-width={shape.width}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/snippet}

<!-- A phone turned with the list open: the list follows its button. -->
<svelte:window onresize={() => picking && place()} />

<div class="box brush-box" role="group" aria-label={t('brush.box')}>
  <!-- Only where there is something to switch to: the feather and the pixel
       have no other form, so the list would offer a choice of one. -->
  {#if hasBrushTypes(editor.tool)}
    <h2 class="type-title">{t('brush.type')}</h2>
    <!-- A list that drops down, not a row of keys: three names never fit the
         box's width, and each one is worth a sample of what it draws. -->
    <button
      class="trigger"
      bind:this={trigger}
      popovertarget={listId}
      aria-label={t('brush.type_of', { label: current.label })}
    >
      {@render sample(brushOfType('pencil', current.id))}
      <span class="name">{current.label}</span>
      <span class="caret"><Icon name={picking ? 'chevron-up' : 'chevron-down'} /></span>
    </button>
    <div
      class="types"
      id={listId}
      popover
      bind:this={list}
      style:left="{at.x}px"
      style:top="{at.y}px"
      ontoggle={(e) => opened((e as ToggleEvent).newState === 'open')}
    >
      {#each types as option (option.id)}
        <button
          class="type"
          class:active={editor.brushType === option.id}
          aria-pressed={editor.brushType === option.id}
          onkeydown={walk}
          onfocusout={(e) => {
            // Tab out of the list closes it: an open list left behind covers
            // the sliders the focus has moved on to.
            const to = e.relatedTarget as Node | null;
            if (to && !list?.contains(to)) list?.hidePopover();
          }}
          onclick={() => {
            editor.brushType = option.id;
            list?.hidePopover();
          }}
        >
          <span class="name">{option.label}</span>
          <span class="hint">{option.hint}</span>
          {@render sample(brushOfType('pencil', option.id))}
        </button>
      {/each}
    </div>
  {/if}
  <!-- The brush in hand, with the settings as they stand: the numbers below
       are hard to read as a line, and this is that line. A brush that stamps
       marks instead of drawing one hands back nothing, and then there is
       nothing to show. -->
  {#if preview(editor.brushTool).d}
    <figure class="live" aria-label={t('brush.sample')}>
      {@render sample(editor.brushTool)}
    </figure>
  {/if}
  <h2>{t('brush.thickness')}</h2>
  {@render slider(t('brush.sizes_group'), editor.brushRange.min, editor.brushSizeMax, editor.brushSizeLogical, (v) => (editor.brushSizeLogical = v), true)}
  <!-- Only for the brushes the two numbers actually reach: the Multator line,
       the old pen and the pixel are smoothed by their own rule or by none.
       Each one says which way it pulls: a number alone is not an answer to
       «what should I set». -->
  {#if editor.brushSmooths}
    {@render heading(t('brush.smooth'), t('brush.smooth_hint'))}
    {@render slider(t('brush.smooth'), 1, 100, editor.brushSmooth, (v) => editor.setBrushSmooth(v))}
    {@render heading(t('brush.simplify'), t('brush.simplify_hint'))}
    {@render slider(t('brush.simplify_slider'), 0, 30, editor.brushMinDistance, (v) => editor.setBrushMinDistance(v))}
  {/if}
</div>
<style>
  .box {
    width: 225px;
    max-width: 100%;
    border: none;
    border-radius: var(--r-md);
    background: var(--canvas);
    /* `auto`, not `hidden`: the radius still clips, but the box lives in a rail
       with a ceiling and is routinely shorter than what is in it — 319 around
       385 on a desktop, 173 around 377 on a phone — and `hidden` does not offer
       a way to the rest, it closes one. «Упрощение» and its slider were simply
       unreachable, with nothing above them to scroll either. */
    overflow: auto;
  }
  .brush-box {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 10px;
    align-items: center;
    padding: 10px;
  }
  .brush-box h2 {
    grid-column: 1 / 3;
    margin: 0;
    text-align: center;
    font-size: 1rem;
    font-weight: 400;
    color: var(--ink-2);
  }
  .trigger {
    grid-column: 1 / 3;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: var(--key-h, 2.75rem);
    padding: 0 8px;
    border: none;
    border-radius: var(--r-sm);
    background: var(--sub);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .caret {
    margin-left: auto;
    display: flex;
    color: var(--ink-2);
  }
  .types {
    position: fixed;
    margin: 0;
    width: 240px;
    /* Fixed, so `100%` is the initial containing block — the room that
       actually exists, where `100vw` counts the scrollbar in as well. */
    max-width: calc(100% - 16px);
    /* At 400 % zoom the three types stood 389px tall in a window of 200. */
    max-height: calc(100% - 16px);
    overflow-y: auto;
    padding: 6px;
    border: none;
    border-radius: var(--r-md);
    background: var(--canvas);
    box-shadow: var(--shadow-menu);
  }
  /* A closed popover is hidden by the browser's own `display: none`, which
     any layout declared here would quietly override. */
  .types:popover-open {
    display: grid;
    gap: 4px;
  }
  .type {
    display: grid;
    align-content: center;
    gap: 2px;
    min-height: var(--key-h);
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .type:hover {
    background: var(--paper);
  }
  .type.active {
    border-color: var(--accent);
  }
  .type .name {
    font-weight: 600;
  }
  .type.active .name {
    color: var(--accent-ink);
  }
  .hint {
    font-size: 0.75rem;
    color: var(--ink-2);
  }
  .trigger:focus-visible,
  .type:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .sample {
    color: var(--ink);
    overflow: visible;
  }
  .live {
    grid-column: 1 / 3;
    margin: 0;
    padding: 2px 6px;
    border: none;
    border-radius: var(--r-sm);
    background: var(--canvas);
  }
  .live .sample {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 1;
  }
  .field {
    position: relative;
  }
  .note {
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    z-index: 2;
    display: none;
    padding: 6px 8px;
    border: none;
    border-radius: var(--r-sm);
    background: var(--canvas);
    box-shadow: var(--shadow-menu);
    font-size: 0.75rem;
    line-height: 1.25;
    text-align: left;
    color: var(--ink-2);
  }
  .note.open {
    display: block;
  }
  /* 1.1rem was the drawn size of the glyph and the size of the target with it —
     18px, under any floor at all. The glyph stays the glyph's size; the box
     around it is the product's, not the standard's minimum: DESIGN §5 keeps 44
     for everything outside the montage grid, and a help key in a tool panel is
     outside it. The background is `none`, so what grows is the target, not a
     circle on the screen. */
  .info {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--key-h, 2.75rem);
    height: var(--key-h, 2.75rem);
    padding: 0;
    vertical-align: -0.2rem;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--ink-2);
    cursor: pointer;
  }
  .info:hover,
  .info:focus-visible {
    color: var(--accent-ink);
  }
  .info:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* The sample keeps the box's own proportions: a line squeezed into another
     aspect would be drawn at a thickness the brush does not have. */
  /* It gives way first when the box is narrow (320px phone): the name and
     the caret were pushed out past the edge. */
  .trigger .sample {
    width: 52px;
    min-width: 0;
    aspect-ratio: 4 / 1;
    flex: 0 100 auto;
  }
  .trigger .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .type .sample {
    width: 100%;
    aspect-ratio: 4 / 1;
    margin-top: 2px;
  }
  .brush-box input[type='range'] {
    width: 100%;
    /* A native range is 16px tall, and these three are the most-pressed
       controls in the panel — brush thickness is the most repeated movement in
       the editor. The track is drawn where it was; the band a thumb can be
       caught in is a finger deep, and a finger is 44 (DESIGN §5), not 24. */
    height: var(--key-h, 2.75rem);
    margin: 0;
  }
  .brush-box input[type='number'] {
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
  .brush-box input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* The sample is an SVG in `currentColor`, and this mode leaves an SVG's
     colour alone: near-black on a black high-contrast canvas. The picked type
     opts out of the mode (controls.css) and sits on Highlight. */
  @media (forced-colors: active) {
    .sample {
      color: CanvasText;
    }
    .type.active :is(.name, .hint, .sample) {
      color: HighlightText;
    }
  }
  /* A phone gives the box some 170px: with the heading and the big sample
     above it, the thickness — the most-turned setting — was under the fold.
     The trigger already shows the sample and its label names the type. */
  @media (max-width: 40rem) {
    .brush-box {
      gap: 6px;
      padding: 6px 10px;
    }
    .type-title,
    .live {
      display: none;
    }
  }
</style>
