<script lang="ts">
  /**
   * The colours window of the top bar (toonop): one colour in hand — the
   * outline or the fill — chosen five ways. «Круг» is a ring of hues around a
   * disc of saturation × value, «Классика» the square with three sliders,
   * «Гармония» a wheel that shows the hues that go with the chosen one,
   * «Значения» the numbers, «Палитры» the saved grids. Under the first four
   * lie the colours picked last and the drawing's palette.
   *
   * It paints live, as the colour window does; a colour is «picked» — and
   * joins the history — when the hand lets go of it.
   */
  import { onDestroy, untrack } from 'svelte';
  import type { EditorState } from './editor-state.svelte';
  import Dropdown from './Dropdown.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import { hexToRgb, hsvToRgb, parseColourInput, rgbToHex, rgbToHsvExact, type Hsv, type Rgb } from './color-model';
  import { TONIO_DEFAULT_PALETTE, contrastInk, gridStep, overLimit, type SavedPalette } from './color-palette';
  import {
    HARMONIES,
    discToSquare,
    harmonyHues,
    huePoint,
    loadHistory,
    pointHue,
    pushHistory,
    saveHistory,
    squareToDisc,
    type Harmony,
  } from './colour-wheel';
  import { t } from '../i18n';

  let { editor, docked = false }: { editor: EditorState; /** Standing open in a column, not in a key's window. */ docked?: boolean } = $props();

  const TABS = ['disc', 'classic', 'harmony', 'value', 'palettes'] as const;
  type Tab = (typeof TABS)[number];
  const TAB_ICONS: Record<Tab, IconName> = {
    disc: 'disc',
    classic: 'square',
    harmony: 'harmony',
    value: 'sliders',
    palettes: 'palette',
  };
  const TAB_KEY = 'toon-editor:colours-tab';

  /** What the window was on last: read once, kept best-effort. */
  function stored(): { tab: Tab; harmony: Harmony } {
    try {
      const raw = JSON.parse(localStorage.getItem(TAB_KEY) ?? '{}') as { tab?: Tab; harmony?: Harmony };
      return {
        tab: TABS.includes(raw.tab as Tab) ? (raw.tab as Tab) : 'disc',
        harmony: HARMONIES.includes(raw.harmony as Harmony) ? (raw.harmony as Harmony) : 'complementary',
      };
    } catch {
      return { tab: 'disc', harmony: 'complementary' };
    }
  }
  const was = stored();
  let tab = $state<Tab>(was.tab);
  let harmony = $state<Harmony>(was.harmony);
  $effect(() => {
    try {
      localStorage.setItem(TAB_KEY, JSON.stringify({ tab, harmony }));
    } catch {
      // blocked storage — the window opens on the disc next time.
    }
  });

  let target = $state<'outline' | 'fill'>('outline');
  const current = $derived(target === 'fill' ? editor.fillColor : editor.brushColor);
  const hexOf = (c: Hsv): string => rgbToHex(hsvToRgb(c));
  /**
   * The colour as the hand holds it. Kept beside the hex, not read from it:
   * a grey has no hue and black no saturation, and the reticle would jump to
   * red each time the hand passed through one.
   */
  let hsv = $state<Hsv>(untrack(() => rgbToHsvExact(hexToRgb(current))));
  $effect.pre(() => {
    // Changed from outside — a pipette, a swatch, the other target.
    if (hexOf(hsv) !== current) hsv = rgbToHsvExact(hexToRgb(current));
  });
  const rgb = $derived(hexToRgb(current));

  let history = $state(loadHistory());
  function remember(colour = current): void {
    history = pushHistory(history, colour);
    saveHistory(history);
  }
  function clearHistory(): void {
    history = [];
    saveHistory(history);
  }

  /** Paints live; `picked` — the hand let go, the colour joins the history. */
  function set(patch: Partial<Hsv>, picked = false): void {
    hsv = { ...hsv, ...patch };
    editor.pickColor(hexOf(hsv), target, true);
    if (picked) remember();
  }
  function setRgb(patch: Partial<Rgb>): void {
    editor.pickColor(rgbToHex({ ...rgb, ...patch }), target, true);
  }
  function pick(colour: string, to = target): void {
    editor.pickColor(colour, to, true);
    remember(colour);
  }
  /** The right button (a pen's or a finger's long press) takes a swatch into the fill, as in the palette box. */
  function pickFill(e: MouseEvent, colour: string): void {
    e.preventDefault();
    pick(colour, 'fill');
  }

  // The colour the window was closed on joins the palette under «добавлять
  // выбранный цвет в палитру», as the colour window's does — once, on the way
  // out, not at every stop of the hand.
  const opened = untrack(() => ({ outline: editor.brushColor, fill: editor.fillColor }));
  onDestroy(() => {
    if (!editor.ux.colorGrid || !editor.settings.paletteAutoAdd) return;
    if (editor.brushColor !== opened.outline) editor.addColorToPalette(editor.brushColor);
    if (editor.fillColor !== opened.fill) editor.addColorToPalette(editor.fillColor);
  });

  /**
   * A surface under the pointer: `move` gets the offset from its centre, −1..1
   * each way, from the press until the release — which is the pick.
   */
  function drag(e: PointerEvent, move: (x: number, y: number) => void): void {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const at = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      move(((ev.clientX - r.left) / r.width) * 2 - 1, ((ev.clientY - r.top) / r.height) * 2 - 1);
    };
    el.setPointerCapture(e.pointerId);
    el.focus();
    at(e);
    el.onpointermove = at;
    el.onpointerup = el.onpointercancel = () => {
      el.onpointermove = el.onpointerup = el.onpointercancel = null;
      remember();
    };
  }

  const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
  /** The disc inside the ring, and the ring's inner edge, in halves of the box. */
  const DISC = 0.62;
  const RING = 0.72;
  /** Which of the two the press began on: the hand may wander off it. */
  let zone: 'ring' | 'disc' = 'disc';

  function onDisc(e: PointerEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = ((e.clientY - r.top) / r.height) * 2 - 1;
    zone = Math.hypot(x, y) > (DISC + RING) / 2 ? 'ring' : 'disc';
    drag(e, (dx, dy) => {
      if (zone === 'ring') return set({ h: pointHue(dx, dy) });
      const at = discToSquare(dx / DISC, dy / DISC);
      set({ s: (at.x + 1) * 50, v: (1 - at.y) * 50 });
    });
  }
  const onSquare = (e: PointerEvent) =>
    drag(e, (x, y) => set({ s: clamp((x + 1) * 50, 0, 100), v: clamp((1 - y) * 50, 0, 100) }));
  const onWheel = (e: PointerEvent) =>
    drag(e, (x, y) => set({ h: pointHue(x, y), s: Math.min(1, Math.hypot(x, y)) * 100 }));

  /**
   * The keys of a surface: the arrows move its two axes, Alt (or the wheel's
   * own sideways) the hue; Shift takes ten steps. The sliders of «Значения»
   * are the same colour by number.
   */
  function onSurfaceKey(e: KeyboardEvent, wheel = false): void {
    const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const dy = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    if (wheel) set({ h: (hsv.h + dx * step + 360) % 360, s: clamp(hsv.s + dy * step, 0, 100) }, true);
    else if (e.altKey) set({ h: (hsv.h + (dx || dy) * step + 360) % 360 }, true);
    else set({ s: clamp(hsv.s + dx * step, 0, 100), v: clamp(hsv.v + dy * step, 0, 100) }, true);
  }

  // The disc is the one surface CSS cannot paint: the square is bent into it.
  let discCanvas = $state<HTMLCanvasElement | undefined>();
  const DISC_PX = 160;
  $effect(() => {
    const ctx = discCanvas?.getContext('2d');
    if (!ctx) return;
    const h = hsv.h;
    const image = ctx.createImageData(DISC_PX, DISC_PX);
    for (let y = 0, i = 0; y < DISC_PX; y++) {
      for (let x = 0; x < DISC_PX; x++, i += 4) {
        const at = discToSquare(((x + 0.5) / DISC_PX) * 2 - 1, ((y + 0.5) / DISC_PX) * 2 - 1);
        const c = hsvToRgb({ h, s: (at.x + 1) * 50, v: (1 - at.y) * 50 });
        image.data[i] = c.r;
        image.data[i + 1] = c.g;
        image.data[i + 2] = c.b;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });

  /** A point −1..1 as the `left` / `top` of a reticle. */
  const pos = (p: { x: number; y: number }, scale = 1): string =>
    `left: ${50 + p.x * scale * 50}%; top: ${50 + p.y * scale * 50}%`;
  const pure = $derived(`hsl(${hsv.h} 100% 50%)`);
  const discAt = $derived(squareToDisc(hsv.s / 50 - 1, 1 - hsv.v / 50));
  const mates = $derived(harmonyHues(hsv.h, harmony).map((h) => ({ h, colour: hexOf({ ...hsv, h }) })));

  const HUES = 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)';
  const ramp = (from: Hsv | Rgb, to: Hsv | Rgb): string => {
    const hex = (c: Hsv | Rgb) => ('h' in c ? hexOf(c) : rgbToHex(c));
    return `linear-gradient(to right, ${hex(from)}, ${hex(to)})`;
  };

  function onHex(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const colour = parseColourInput(input.value);
    if (colour) pick(colour);
    input.value = current;
  }

  /** A grid of swatches is one Tab stop; the arrows walk it. */
  function onCellKey(e: KeyboardEvent, i: number): void {
    const cells = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('.cell');
    if (!cells) return;
    // As many to a row as the grid draws: ten in the window, fewer standing in a column.
    const cols = getComputedStyle(cells[0].parentElement!).gridTemplateColumns.split(' ').length;
    const next = gridStep(i, e.key, cells.length, cols);
    if (next === null || next === i) return;
    e.preventDefault();
    cells[next].focus();
  }

  const DEFAULT: SavedPalette = { id: -1, name: t('palette.default_name'), created: 0, colours: [...TONIO_DEFAULT_PALETTE] };
  const saved = $derived([...editor.savedPalettes].reverse().concat(DEFAULT));

  async function savePalette(): Promise<void> {
    const name = (await editor.askText(t('palette.save_prompt'), t('palette.new_name')))?.trim();
    if (name && !editor.saveCurrentPalette(name)) void editor.tell(t('palette.not_stored'));
  }
  async function usePalette(p: SavedPalette): Promise<void> {
    const limit = editor.settings.paletteLimit;
    const skipped = overLimit(p.colours, limit);
    if (!(await editor.ask(skipped > 0 ? t('palette.replace_over_confirm', { skipped, limit }) : t('palette.replace_confirm')))) return;
    editor.replacePalette(p.colours);
  }
  async function deletePalette(p: SavedPalette): Promise<void> {
    if (await editor.ask(t('palette.delete_confirm'), t('ask.delete'), true)) editor.deleteSavedPalette(p.id);
  }
</script>

{#snippet slider(name: string, letter: string, value: number, max: number, track: string, oninput: (n: number) => void, shown: string)}
  <label class="slider">
    <span class="letter" aria-hidden="true">{letter}</span>
    <input
      type="range"
      min="0"
      {max}
      value={Math.round(value)}
      aria-label={name}
      style:--track={track}
      oninput={(e) => oninput(e.currentTarget.valueAsNumber)}
      onchange={() => remember()}
    />
    <span class="number" aria-hidden="true">{shown}</span>
  </label>
{/snippet}

{#snippet hsvSliders()}
  {@render slider(t('colours.hue'), 'H', hsv.h, 359, HUES, (h) => set({ h }), `${Math.round(hsv.h)}°`)}
  {@render slider(t('colours.saturation'), 'S', hsv.s, 100, ramp({ ...hsv, s: 0 }, { ...hsv, s: 100 }), (s) => set({ s }), `${Math.round(hsv.s)}%`)}
  {@render slider(t('colours.value'), 'B', hsv.v, 100, ramp({ ...hsv, v: 0 }, { ...hsv, v: 100 }), (v) => set({ v }), `${Math.round(hsv.v)}%`)}
{/snippet}

{#snippet swatches(colours: readonly string[], label: string)}
  <div class="cells" role="group" aria-label={label}>
    {#each colours as colour, i (colour)}
      <button
        class="cell"
        class:active={colour === current}
        aria-pressed={colour === current}
        style:--swatch={colour}
        style:color={contrastInk(colour)}
        tabindex={i === 0 ? 0 : -1}
        onclick={() => pick(colour)}
        oncontextmenu={(e) => pickFill(e, colour)}
        onkeydown={(e) => onCellKey(e, i)}
        title={t('colours.swatch_title', { color: colour })}
        aria-label={t('color.swatch', { color: colour })}
      ></button>
    {/each}
  </div>
{/snippet}

{#snippet drawingPalette()}
  <section>
    <div class="row">
      <h3>{t('colours.current')}</h3>
      <button class="key icon" onclick={() => editor.addColorToPalette(current)} title={t('color.add')} aria-label={t('color.add')}>
        <Icon name="plus" />
      </button>
    </div>
    {#if editor.palette.length > 0}
      {@render swatches(editor.palette, t('colours.current'))}
    {:else}
      <p class="empty">{t('color.empty')}</p>
    {/if}
  </section>
{/snippet}

<div class="colours" class:docked>
  <header>
    <h2>{tab === 'palettes' ? t('colours.palettes') : t('colours.title')}</h2>
    {#if tab === 'palettes'}
      <button class="key icon" onclick={savePalette} title={t('palette.save_title')} aria-label={t('palette.save_title')}>
        <Icon name="plus" />
      </button>
    {/if}
    <!-- The two colours in hand; the pressed one is the one being chosen. -->
    <div class="pair" role="group" aria-label={t('colours.target')}>
      {#each [['outline', editor.brushColor, t('color.stroke')], ['fill', editor.fillColor, t('colours.fill')]] as [id, colour, name] (id)}
        <button
          class="hand"
          class:active={target === id}
          aria-pressed={target === id}
          style:--swatch={colour}
          onclick={() => (target = id as 'outline' | 'fill')}
          title={name}
          aria-label={`${name} ${colour}`}
        ></button>
      {/each}
    </div>
  </header>

  <div class="stage">
    {#if tab === 'disc'}
      <div
        class="surface disc"
        role="slider"
        tabindex="0"
        aria-label={t('colours.disc_keys')}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={current}
        onpointerdown={onDisc}
        onkeydown={(e) => onSurfaceKey(e)}
      >
        <div class="ring"></div>
        <canvas bind:this={discCanvas} width={DISC_PX} height={DISC_PX}></canvas>
        <span class="reticle" style={pos(huePoint(hsv.h, (1 + RING) / 2))} style:--swatch={pure}></span>
        <span class="reticle big" style={pos(discAt, DISC)} style:--swatch={current}></span>
      </div>
    {:else if tab === 'classic'}
      <div
        class="surface square"
        role="slider"
        tabindex="0"
        aria-label={t('colours.square_keys')}
        aria-valuenow={Math.round(hsv.s)}
        aria-valuetext={current}
        style:--pure={pure}
        onpointerdown={onSquare}
        onkeydown={(e) => onSurfaceKey(e)}
      >
        <span class="reticle" style={pos({ x: hsv.s / 50 - 1, y: 1 - hsv.v / 50 })} style:--swatch={current}></span>
      </div>
    {:else if tab === 'harmony'}
      <div class="mode">
        <Dropdown
          label={t('colours.harmony')}
          value={harmony}
          options={HARMONIES.map((value) => ({ value, label: t(`colours.harmonies.${value}`) }))}
          onpick={(next) => (harmony = next)}
        />
      </div>
      <div
        class="surface wheel"
        role="slider"
        tabindex="0"
        aria-label={t('colours.wheel_keys')}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={current}
        onpointerdown={onWheel}
        onkeydown={(e) => onSurfaceKey(e, true)}
      >
        <div class="hues" style:filter={`brightness(${hsv.v / 100})`}></div>
        {#each mates as mate (mate.h)}
          <!-- The colour that goes with the chosen one: pressed, it is the chosen one. -->
          <button
            class="reticle mate"
            style={pos(huePoint(mate.h, hsv.s / 100))}
            style:--swatch={mate.colour}
            onpointerdown={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            onclick={() => pick(mate.colour)}
            oncontextmenu={(e) => pickFill(e, mate.colour)}
            title={t('colours.swatch_title', { color: mate.colour })}
            aria-label={t('colours.mate', { color: mate.colour })}
          ></button>
        {/each}
        <span class="reticle big" style={pos(huePoint(hsv.h, hsv.s / 100))} style:--swatch={current}></span>
      </div>
    {:else if tab === 'value'}
      <div class="sliders">{@render hsvSliders()}</div>
      <label class="hex">
        <span>{t('colours.hex')}</span>
        <input type="text" value={current} spellcheck="false" autocomplete="off" maxlength="32" onchange={onHex} />
      </label>
    {:else}
      {@render drawingPalette()}
    {/if}
  </div>

  <div class="rest">
    {#if tab === 'classic'}
      <div class="sliders bare">{@render hsvSliders()}</div>
    {:else if tab === 'harmony'}
      <div class="sliders bare">
        {@render slider(t('colours.value'), 'B', hsv.v, 100, ramp({ ...hsv, v: 0 }, { ...hsv, v: 100 }), (v) => set({ v }), `${Math.round(hsv.v)}%`)}
      </div>
    {:else if tab === 'value'}
      <div class="sliders">
        {@render slider(t('colours.red'), 'R', rgb.r, 255, ramp({ ...rgb, r: 0 }, { ...rgb, r: 255 }), (r) => setRgb({ r }), String(rgb.r))}
        {@render slider(t('colours.green'), 'G', rgb.g, 255, ramp({ ...rgb, g: 0 }, { ...rgb, g: 255 }), (g) => setRgb({ g }), String(rgb.g))}
        {@render slider(t('colours.blue'), 'B', rgb.b, 255, ramp({ ...rgb, b: 0 }, { ...rgb, b: 255 }), (b) => setRgb({ b }), String(rgb.b))}
      </div>
    {:else if tab === 'palettes'}
      {#each saved as p (p.id)}
        <section>
          <div class="row">
            <h3>{p.name || t('palette.new_name')}</h3>
            <button class="key" onclick={() => usePalette(p)} title={t('colours.use_title')}>{t('colours.use')}</button>
            {#if p.id >= 0}
              <button class="key icon" onclick={() => deletePalette(p)} title={t('colours.delete')} aria-label={t('colours.delete_named', { name: p.name })}>
                <Icon name="trash" />
              </button>
            {/if}
          </div>
          {@render swatches(p.colours, p.name)}
        </section>
      {/each}
    {/if}

    {#if tab !== 'palettes'}
      <section class="history">
        <div class="row">
          <h3>{t('colours.history')}</h3>
          <button class="key" disabled={history.length === 0} onclick={clearHistory}>{t('colours.clear')}</button>
        </div>
        {#if history.length > 0}
          {@render swatches(history, t('colours.history'))}
        {:else}
          <div class="cells blank" aria-hidden="true"></div>
        {/if}
      </section>
      {#if editor.palette.length > 0}
        <section>
          <div class="row name"><h3>{t('color.grid')}</h3></div>
          {@render swatches(editor.palette, t('color.grid'))}
        </section>
      {/if}
    {/if}
  </div>

  <div class="tabs" role="group" aria-label={t('colours.ways')}>
    {#each TABS as id (id)}
      <button class="tab" class:active={tab === id} aria-pressed={tab === id} title={docked ? t(`colours.tab.${id}`) : undefined} onclick={() => (tab = id)}>
        <Icon name={TAB_ICONS[id]} size={20} />
        <span>{t(`colours.tab.${id}`)}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .colours {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    box-sizing: border-box;
    width: 21rem;
    max-width: 100%;
    padding: 0.6rem 0.75rem 0;
    color: var(--text);
    /* The colour space itself, not the studio's ink: the hues the way the
       ring and the wheel run — red on the right, then against the clock
       (colour-wheel.ts `pointHue`), so clockwise from there they run
       backwards — and the two ends every hue is mixed towards. */
    --hues-back: #f00, #f0f, #00f, #0ff, #0f0, #ff0, #f00;
    --white: #fff;
    --black: #000;
  }
  /* Standing open in a column (toonop on a desk): the column is its plate
     and pads it, and is two thirds of the window's width — the cells are as
     many to a row as have the room, the tabs their icons alone (the word is
     the key's title and its name). */
  .colours.docked {
    width: 100%;
    max-width: 21rem;
    margin: 0 auto;
    padding: 0;
    /* Closer, and the surface a little under the column's width: on a
       1440×900 screen the whole panel stands in the column unscrolled. */
    gap: 0.4rem;
    /* No taller than the column gives it: what gives way is the swatches,
       which scroll on their own between the surface and the tabs. */
    min-height: 0;
    max-height: 100%;
  }
  .colours.docked > :global(*),
  .colours.docked .stage > :global(*) {
    flex: none;
  }
  .colours.docked .rest {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    gap: 0.4rem;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .colours.docked .rest > :global(*) {
    flex: none;
  }
  /* The palette's name is the group's own (aria-label): under the history
     the grid reads as what it is, and the line it took is a row of swatches. */
  .colours.docked .row.name {
    display: none;
  }
  .colours.docked .surface:not(.square) {
    max-width: 10.5rem;
  }
  /* A laptop's column: the surface gives the swatches some of its room, and
     the history its own — the palette is what stays (a colour drawn with
     joins it by itself), whole and unscrolled on 1536×864 and 1366×768. */
  @media (max-height: 55rem) {
    .colours.docked .surface:not(.square) {
      max-width: 9rem;
    }
    .colours.docked .history {
      display: none;
    }
  }
  .colours.docked .cells {
    grid-template-columns: repeat(auto-fill, minmax(1.5rem, 1fr));
  }
  .colours.docked .tabs {
    position: static;
    margin: 0;
    padding-inline: 0;
  }
  .colours.docked .tab {
    min-height: var(--key-h);
  }
  .colours.docked .tab span {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* The surface, or what stands for it, and what follows it: one column
     here, two in a low window (below). */
  .stage,
  .rest {
    display: contents;
  }
  header,
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  h2,
  h3 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  h2 {
    font-size: 1.05rem;
  }
  h3 {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-2);
  }
  .row {
    min-height: var(--key-h);
  }
  .pair {
    display: flex;
    gap: 0.35rem;
  }
  /* A colour in hand: a key tall, told from the other by the ring. */
  .hand {
    width: 3rem;
    height: var(--key-h);
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .hand::before {
    content: '';
    width: 100%;
    height: 1.9rem;
    border-radius: var(--r-sm);
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .hand.active::before {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .hand:focus-visible,
  .surface:focus-visible,
  .cell:focus-visible,
  .tab:focus-visible,
  .mate:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .surface {
    position: relative;
    align-self: center;
    width: 100%;
    max-width: 17rem;
    aspect-ratio: 1;
    touch-action: none;
    cursor: crosshair;
    border-radius: 50%;
  }
  .ring,
  .hues {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(from 90deg, var(--hues-back));
  }
  .ring {
    /* 72 % is RING: the ring's inner edge. */
    -webkit-mask: radial-gradient(closest-side, transparent 72%, #000 calc(72% + 1px));
    mask: radial-gradient(closest-side, transparent 72%, #000 calc(72% + 1px));
  }
  .hues {
    background:
      radial-gradient(closest-side, var(--white), transparent),
      conic-gradient(from 90deg, var(--hues-back));
  }
  .disc canvas {
    position: absolute;
    /* 62 % is DISC: (100 − 62) / 2 from each edge. */
    inset: 19%;
    width: 62%;
    height: 62%;
    border-radius: 50%;
  }
  .surface.square {
    max-width: none;
    aspect-ratio: 4 / 3;
    border-radius: var(--r-sm);
    background:
      linear-gradient(to top, var(--black), transparent),
      linear-gradient(to right, var(--white), transparent),
      var(--pure);
  }
  .reticle {
    position: absolute;
    width: 1.1rem;
    height: 1.1rem;
    padding: 0;
    translate: -50% -50%;
    border: 2px solid var(--canvas);
    border-radius: 50%;
    background: var(--swatch);
    /* A dark line outside the white one: the ring reads on any colour. */
    box-shadow: 0 0 0 1px var(--edge);
    pointer-events: none;
  }
  .reticle.big {
    width: 1.7rem;
    height: 1.7rem;
  }
  .reticle.mate {
    pointer-events: auto;
    cursor: pointer;
    /* Its drawing is the ring; its target a key's worth around it. */
    box-sizing: content-box;
    background-clip: padding-box;
  }
  .reticle.mate::after {
    content: '';
    position: absolute;
    inset: -0.9rem;
  }

  .sliders {
    display: flex;
    flex-direction: column;
    padding: 0 0.6rem;
    border-radius: var(--r-sm);
    background: var(--well);
  }
  .sliders.bare {
    padding: 0;
    background: none;
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: var(--key-h);
  }
  .slider input {
    flex: 1;
    min-width: 0;
  }
  /* The track is the colour the knob would give at each point of it. */
  .slider input::-webkit-slider-runnable-track {
    background: var(--track);
  }
  .slider input::-moz-range-track {
    background: var(--track);
  }
  .letter {
    width: 0.8rem;
    font-weight: 700;
    color: var(--ink-2);
  }
  .number {
    width: 2.6rem;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .hex {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0 0.6rem;
    min-height: var(--key-h);
    border-radius: var(--r-sm);
    background: var(--well);
    font-weight: 700;
  }
  .hex input {
    width: 7rem;
    text-align: center;
    text-transform: uppercase;
  }

  section {
    display: flex;
    flex-direction: column;
    /* A key in the heading's row is a key tall: it stood on the swatches. */
    gap: 0.4rem;
  }
  /* Ten to a row, edge to edge: the rows read as one swatch card. */
  .cells {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--sub);
  }
  .cells.blank {
    height: 1.9rem;
  }
  .cell {
    aspect-ratio: 1;
    min-height: 1.5rem;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--swatch);
    cursor: pointer;
  }
  /* The colour in hand: a ring in the ink that reads on it. */
  .cell.active {
    box-shadow: inset 0 0 0 2px currentColor;
  }
  .cell:focus-visible {
    outline-color: currentColor;
    outline-offset: -4px;
  }
  .empty {
    margin: 0;
    padding-bottom: 0.5rem;
    font-size: 0.85rem;
    color: var(--ink-2);
  }
  .mode {
    display: flex;
  }

  .tabs {
    position: sticky;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    margin: 0 -0.75rem;
    padding: 0.25rem 0.4rem;
    background: var(--paper);
    border-top: 1px solid var(--hairline);
  }
  .tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    min-width: 0;
    min-height: 3.1rem;
    padding: 0.2rem 0;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 0.7rem;
    font-weight: 700;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease-out), color var(--dur) var(--ease-out);
  }
  .tab span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab.active {
    color: var(--accent);
  }
  /* A low window — a phone lying down: under the key there is half the room
     the column takes, and the ring stood cut over the tabs. The surface
     stands beside the rest, as tall as the room (`--room`, told by the key's
     plate); the rest scrolls on its own between the heading and the tabs.
     ponytail: asked of the window, not of the room — a key on a bottom row of
     a tall window still gets the column; branch on `--room` if that shows. */
  @media (max-height: 36rem) and (min-width: 40rem) {
    .colours:not(.docked) {
      /* The plate's two hairlines and the padding over and under the surface. */
      --side: min(17rem, var(--room) - 1.2rem - 2px);
      display: grid;
      /* Five tabs with their words take 19rem; an iPhone SE lying down is 41 wide. */
      grid-template: auto minmax(0, 1fr) auto / auto 19rem;
      column-gap: 0.75rem;
      width: auto;
      height: calc(var(--side) + 1.2rem);
    }
    .colours:not(.docked) .stage,
    .colours:not(.docked) .rest {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .colours:not(.docked) .stage {
      grid-area: 1 / 1 / -1 / 2;
      /* The width a list in it is drawn for; a surface is its own. */
      min-width: 17rem;
      padding-bottom: 0.6rem;
    }
    .colours:not(.docked) header {
      grid-area: 1 / 2;
    }
    .colours:not(.docked) .rest {
      grid-area: 2 / 2;
    }
    .colours:not(.docked) .tabs {
      position: static;
      grid-area: 3 / 2;
      margin: 0 -0.4rem;
    }
    .colours:not(.docked) .surface {
      flex: none;
      width: var(--side);
      max-width: none;
    }
    /* Square here: a wider one made the plate wider than its key placed it. */
    .colours:not(.docked) .surface.square {
      aspect-ratio: 1;
    }
    /* The list of harmonies stands over the wheel, and takes a key of its height. */
    .colours:not(.docked) .surface.wheel {
      width: calc(var(--side) - var(--key-h) - 0.5rem);
    }
  }
  @media (hover: hover) {
    .tab:hover {
      background: var(--sub);
    }
  }
  @media (forced-colors: active) {
    .reticle,
    .cell,
    .hand::before {
      forced-color-adjust: none;
    }
  }
</style>
