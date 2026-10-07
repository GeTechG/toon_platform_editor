<script lang="ts">
  /**
   * The brush box: the type of brush, then thickness and smoothing as
   * sliders. The plain row of dots is its own widget (BrushSizes), colour
   * another (ColorPanel/PaletteBox).
   */
  import { brushOfType, brushTypesFor, hasBrushTypes } from '../plugins/brush-types';
  import { brushPreview, PREVIEW_BOX } from './brush-preview';
  import { SIZE_TRACK, positionOfSize, sizeAtPosition, sizeByKey } from './size-scale';
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
  // The register is no state of its own: a plugin that came, went or broke
  // is heard through `pluginsVersion`, or the list kept the old types until
  // the tool was changed.
  const types = $derived.by(() => {
    void editor.pluginsVersion;
    return brushTypesFor(editor.tool);
  });
  const offered = $derived.by(() => {
    void editor.pluginsVersion;
    return hasBrushTypes(editor.tool);
  });

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
  let at = $state<{ x: number; y: number; room: number | null }>({ x: 0, y: 0, room: null });

  /**
   * Under the button, or above it when the bottom of the window is too near.
   * Where it fits neither side it takes the roomier one and scrolls inside
   * it: laid over its own button, a second press picked a type instead of
   * closing the list.
   */
  function place(): void {
    if (!list || !trigger) return;
    const anchor = trigger.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    // The whole list, not what an earlier limit left of it.
    const tall = list.scrollHeight;
    const below = anchor.bottom + 4;
    const under = window.innerHeight - 8 - below;
    const over = anchor.top - 4 - 8;
    const up = tall > under && over > under;
    const room = up ? over : under;
    const x = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8));
    // No side holds even two types (400 % zoom): the list takes the window.
    if (room < 120) at = { x, y: 8, room: null };
    else at = { x, y: up ? anchor.top - 4 - Math.min(tall, over) : below, room };
  }

  /**
   * Safari before 17 and Firefox before 125 have no `popover`: there the list
   * is shown and hidden by hand, or it stood open in the top left corner over
   * the canvas and a pick threw on `hidePopover`.
   */
  const popoverWorks = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

  async function opened(open: boolean): Promise<void> {
    picking = open;
    if (!open) return;
    // Without the top layer the list is only drawn once the state is out.
    if (!popoverWorks) await tick();
    place();
    list?.querySelector<HTMLButtonElement>('.type.active')?.focus();
  }

  function close(): void {
    if (popoverWorks) list?.hidePopover();
    else if (picking) {
      // A popover hands the focus back to its button by itself; the hidden
      // list by hand left it nowhere, and Tab started over from the top.
      const inside = list?.contains(document.activeElement);
      opened(false);
      if (inside) trigger?.focus();
    }
  }

  /**
   * Without a popover, a press anywhere else closes the list, as the browser
   * does for one. It closes an open help too: Safari never focuses a tapped
   * key, so no blur came, and the words lay over the slider below until the
   * «i» was pressed again.
   */
  function pressedElsewhere(e: PointerEvent): void {
    const on = e.target as Node;
    if (!popoverWorks && picking && !list?.contains(on) && !trigger?.contains(on)) close();
    if (openNote !== null && !(on as Element).closest?.('.info')) openNote = null;
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
    if (e.key === 'Escape' && !popoverWorks) {
      // The browser's own light dismiss, by hand.
      e.preventDefault();
      close();
      trigger?.focus();
      return;
    }
    if (next === undefined) return;
    e.preventDefault();
    keys[(next + keys.length) % keys.length]?.focus();
  }

  /** Which heading's help is open: one at a time, until pressed again, Esc or blur. */
  let openNote = $state<string | null>(null);

  // A tool with no types takes the list away while it may be open (F from
  // inside it), and a removed popover sends no `toggle`: the caret stood
  // pointing up, and without `popover` the list came back open by itself.
  $effect(() => {
    if (!hasBrushTypes(editor.tool)) picking = false;
    void editor.pluginsVersion;
  });

  // The smoothing headings leave with a brush they do not reach, their «i»
  // with them, and no blur comes for a removed key (nor for one Safari never
  // focused): coming back, the help stood open without a press.
  $effect(() => {
    if (!editor.brushSmooths && openNote !== t('brush.thickness')) openNote = null;
  });
</script>

<!-- Thickness runs on a logarithmic track (size-scale.ts): the thin sizes
     everybody draws with get most of it. The track holds positions, so the
     reader hears the size, and a key steps a whole size, as + and − do — at
     the thin end one step of the track would not reach the next whole size.
     Let go between two sizes, the thumb goes to the one it gave: the value
     is written only when the size changes, and at «1» it stood wherever the
     hand left it, up to a sixteenth of the track off.
     `pixels`: a linear track in logical pixels (the simplify step), which the
     reader hears with its unit, as the thickness. -->
{#snippet slider(label: string, min: number, max: number, value: number, set: (v: number) => void, log = false, pixels = false)}
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
      onchange={(e) => (e.currentTarget.value = String(Math.round(positionOfSize(value, min, max))))}
      onkeydown={(e) => {
        // The arrows step as + and − do, by the preset's own ladder.
        const next = sizeByKey(e.key, value, min, max, editor.ux);
        if (next === null) return;
        e.preventDefault();
        set(next);
      }}
    />
  {:else}
    <input
      type="range"
      {min}
      {max}
      {value}
      aria-label={label}
      aria-valuetext={pixels ? t('brush.size_value', { count: value }) : undefined}
      oninput={(e) => set(e.currentTarget.valueAsNumber)}
    />
  {/if}
  <input
    type="number"
    inputmode="numeric"
    {min}
    {max}
    {value}
    aria-label={t('brush.number_of', { label })}
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
    <span class="field-title">{title}</span>
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

<!-- A phone turned, or the box scrolled, with the list open: the list follows
     its button. -->
<svelte:window onresize={() => picking && place()} onscrollcapture={() => picking && place()} onpointerdown={pressedElsewhere} />

<div class="box brush-box" role="group" aria-label={t('brush.box')}>
  <!-- Only where there is something to switch to: the feather and the pixel
       have no other form, so the list would offer a choice of one. -->
  {#if offered}
    <h2 class="type-title">{t('brush.type')}</h2>
    <!-- A list that drops down, not a row of keys: three names never fit the
         box's width, and each one is worth a sample of what it draws. -->
    <button
      class="trigger"
      bind:this={trigger}
      popovertarget={listId}
      aria-expanded={popoverWorks ? undefined : picking}
      aria-label={t('brush.type_of', { label: current.label })}
      onclick={() => !popoverWorks && opened(!picking)}
    >
      {@render sample(brushOfType(editor.tool, current.id))}
      <span class="name">{current.label}</span>
      <span class="caret"><Icon name={picking ? 'chevron-up' : 'chevron-down'} /></span>
    </button>
    <div
      class="types"
      id={listId}
      popover
      class:fallback={!popoverWorks}
      class:open={!popoverWorks && picking}
      bind:this={list}
      style:left="{at.x}px"
      style:top="{at.y}px"
      style:max-height={at.room === null ? null : `${at.room}px`}
      onbeforetoggle={(e) => {
        // `toggle` comes as a task of its own, after the list is drawn: for a
        // frame it stood where it was left — the first time, at 0,0. Here it
        // has no size yet, and placed by a height of zero it stood under the
        // button and then jumped above it: the frame's own callback runs with
        // the list laid out and before it is painted.
        if ((e as ToggleEvent).newState === 'open') requestAnimationFrame(place);
      }}
      ontoggle={(e) => opened((e as ToggleEvent).newState === 'open')}
    >
      {#each types as option (option.id)}
        <button
          class="type"
          class:active={current.id === option.id}
          aria-pressed={current.id === option.id}
          onkeydown={walk}
          onfocusout={(e) => {
            // Tab out of the list closes it: an open list left behind covers
            // the sliders the focus has moved on to. Not to its own button: a
            // press there closed the list, and the click opened it again.
            const to = e.relatedTarget as Node | null;
            if (to && !list?.contains(to) && !trigger?.contains(to)) close();
          }}
          onclick={() => {
            editor.setBrushType(option.id);
            close();
          }}
        >
          <span class="name">{option.label}</span>
          <span class="hint">{option.hint}</span>
          {@render sample(brushOfType(editor.tool, option.id))}
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
  <!-- The drag on the canvas is the main way; the box says it is there. -->
  {@render heading(t('brush.thickness'), t('brush.thickness_hint'))}
  {@render slider(t('brush.sizes_group'), editor.brushRange.min, editor.brushSizeMax, editor.brushSizeLogical, (v) => (editor.brushSizeLogical = v), true)}
  <!-- Only for the brushes the two numbers actually reach: the Multator line,
       the old pen and the pixel are smoothed by their own rule or by none.
       Each one says which way it pulls: a number alone is not an answer to
       «what should I set». -->
  {#if editor.brushSmooths}
    {@render heading(t('brush.smooth'), t('brush.smooth_hint'))}
    {@render slider(t('brush.smooth'), 1, 100, editor.brushSmooth, (v) => editor.setBrushSmooth(v))}
    {@render heading(t('brush.simplify'), t('brush.simplify_hint'))}
    {@render slider(t('brush.simplify_slider'), 0, 30, editor.brushMinDistance, (v) => editor.setBrushMinDistance(v), false, true)}
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
    /* The number keeps a finger's width: on a phone 320 wide at 200 % text a
       third of the box was 42px. The track gives way instead. */
    grid-template-columns: minmax(0, 2fr) minmax(44px, 1fr);
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
  /* Where `popover` is unknown the div is an ordinary one: hidden until its
     button opens it, and above the studio without a top layer to lift it.
     A rule of its own — beside `:popover-open`, which such a browser does not
     parse, it would be thrown away with it. */
  .types.fallback {
    display: none;
    z-index: var(--z-menu);
  }
  .types.fallback.open {
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
  @media (hover: hover) {
    .type:hover {
      background: var(--paper);
    }
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
  /* The title and its «i» on one line, the key never past the box's edge:
     at 200 % text «Сглаживание» alone was wider than a phone's box, and the
     «i» and the word went off into a sideways scroll. The word gives way —
     hyphenated where the browser knows Russian, broken where it does not. */
  .field {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .field-title {
    min-width: 0;
    overflow-wrap: anywhere;
    -webkit-hyphens: auto;
    hyphens: auto;
  }
  /* Beside a title its width stays near the product's 44 px floor: a whole
     2.75rem (88 px at 200 % text) left the word a third of the box. */
  .field .info {
    flex: none;
    width: max(44px, 1.75rem);
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
  .info:focus-visible {
    color: var(--accent-ink);
  }
  @media (hover: hover) {
    .info:hover {
      color: var(--accent-ink);
    }
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
     The trigger already shows the sample and its label names the type.
     The studio's phone step (small-screen.ts), not a width query: a phone
     lying down is wider than 40rem and just as short. */
  :global(:where(.studio.phone)) .brush-box {
    gap: 6px;
    padding: 6px 10px;
  }
  :global(:where(.studio.phone)) .type-title,
  :global(:where(.studio.phone)) .live {
    display: none;
  }
  /* Behind a tool's key in a low window — a phone lying down: 270px under the
     key and a column of 488, the last two sliders under a scroll. A setting
     is one line here — its name, the track, the number — and the list of
     types, which shows its own sample and names itself, stands alone over
     them. Only the box in a key's plate: a side column is as narrow as ever.
     The edges are the colours window's (ColoursPanel). */
  @media (max-height: 36rem) and (min-width: 40rem) {
    :global(.pop-plate) .brush-box {
      grid-template-columns: auto minmax(9rem, 1fr) 4rem;
      gap: 6px 10px;
      width: 25rem;
      padding: 8px 10px;
    }
    :global(.pop-plate) .type-title,
    :global(.pop-plate) .live {
      display: none;
    }
    :global(.pop-plate) .trigger {
      grid-column: 1 / -1;
    }
    :global(.pop-plate) .field {
      grid-column: 1;
      justify-content: space-between;
      text-align: start;
    }
    /* The words of the «i» are as wide as the box, not as its name. */
    :global(.pop-plate) .note {
      right: auto;
      width: 23rem;
    }
  }
  /* In a side column the box is packed closer (owner, 2026-10-06): under the
     palette it ran 58 px past the column on a 1080p screen and the column
     scrolled for the last slider. No «Тип» over a list that names itself,
     smaller gaps, and a heading only as tall as its words — the «i» keeps
     its 44 px and reaches into the empty band of the rows around it. The
     window behind a tool's key (toonop) keeps the roomy form. */
  :global(:where(.studio > aside)) .brush-box {
    gap: 6px;
    padding: 6px 10px;
  }
  :global(:where(.studio > aside)) .type-title {
    display: none;
  }
  :global(:where(.studio > aside)) .field {
    margin-block: -0.5rem;
  }
</style>
