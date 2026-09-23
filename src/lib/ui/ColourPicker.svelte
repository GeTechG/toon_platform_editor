<script lang="ts">
  import { untrack } from 'svelte';
  import { hexToRgb, normalizeHexInput, parseHex, rgbToHex, wheelToHsv } from './color-model';
  import {
    barPointer,
    colorToPointer,
    nudgePointer,
    pickerKeyAction,
    pointerToColor,
    rgbChannelAt,
    surfaceToPointer,
    type PickerModel,
    type Pointer,
  } from './picker-model';
  import { contrastInk } from './color-palette';
  import { clampWindowPosition } from './draggable';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

  let {
    color,
    label,
    x,
    y,
    model,
    onmodel,
    onpick,
    onclose,
  }: {
    color: string;
    label: string;
    /** Viewport coordinates the window opens at (it is fixed, then draggable). */
    x: number;
    y: number;
    /** Colour model, remembered between openings (reference `toonio_picker_mode`). */
    model: PickerModel;
    onmodel: (next: PickerModel) => void;
    onpick: (hex: string) => void;
    /** Esc asks for the original colour back; every other way out accepts. */
    onclose: (options?: { revert?: boolean }) => void;
  } = $props();

  /** Reference #colour_picker: a 176×176 surface over a 176×31 bar. */
  const SURFACE = 176;
  const BAR_H = 31;
  /** Clear pixels either side of a channel column in the rgb model. */
  const COLUMN_GAP = 5;

  const origin = untrack(() => color);
  let pointer = $state<Pointer>(untrack(() => colorToPointer(model, color)));
  /** Last colour this window produced — anything else came from outside. */
  let applied = $state(origin);
  let surface = $state<HTMLCanvasElement | null>(null);
  let bar = $state<HTMLCanvasElement | null>(null);
  let box = $state<HTMLDialogElement | null>(null);
  /**
   * Why the close goes through the element instead of straight to the parent:
   * `close()` is what hands focus back to the swatch that opened the window,
   * and that only happens if the platform runs the close. So every exit records
   * what kind of exit it was and asks the dialog to shut; `onclose` then tells
   * the parent, which unmounts us.
   */
  let intent: { revert?: boolean } = {};

  function requestClose(options: { revert?: boolean } = {}): void {
    intent = options;
    box?.close();
  }

  // Modal, not `open`: the top layer, the focus trap, the Esc and the inert
  // page behind are all `showModal()`'s, and the five sheets of the studio
  // already live on them. The hand-rolled version here wrapped Tab once focus
  // was inside and never brought it in.
  // It opens under its swatch, but the parent only guesses its size: measured
  // here, it is nudged back inside the screen (a phone cut off the hex field).
  $effect(() => {
    if (box && !box.open) {
      box.showModal();
      keepInside();
    }
  });

  /** Nudges the window back inside the screen — on opening, and when a phone turns under it. */
  function keepInside(): void {
    if (!box?.open) return;
    const r = box.getBoundingClientRect();
    const inside = clampWindowPosition(r.left, r.top, r, { width: innerWidth, height: innerHeight });
    offset = { x: offset.x + inside.left - r.left, y: offset.y + inside.top - r.top };
  }
  let hexText = $state(origin);
  /** Window offset from where it opened, moved by dragging the header. */
  let offset = $state({ x: 0, y: 0 });

  const rgb = $derived(hexToRgb(color));

  function apply(next: Pointer): void {
    pointer = next;
    const hex = pointerToColor(model, next);
    hexText = hex;
    applied = hex;
    onpick(hex);
  }

  function setModel(next: PickerModel): void {
    onmodel(next);
    pointer = colorToPointer(next, color);
    applied = color;
  }

  function setChannel(key: 'r' | 'g' | 'b', value: number): void {
    onpick(rgbToHex({ ...rgb, [key]: value }));
  }

  function commitHex(): void {
    const hex = parseHex(hexText);
    if (hex) onpick(hex);
    else hexText = color;
  }

  /** Reference: the field paints as it is typed (`bundle:10144-10152`). */
  function typeHex(raw: string): void {
    hexText = raw;
    const hex = normalizeHexInput(raw);
    // Unrecognised: the colour stays, and the blur or Enter gives the field it back.
    if (!hex) return;
    applied = hex;
    pointer = colorToPointer(model, hex);
    onpick(hex);
  }

  /** Pointer events cover mouse and touch alike; the capture keeps the drag alive outside. */
  function drag(e: PointerEvent, target: 'surface' | 'bar'): void {
    // The primary button only: a right click moved the colour and then opened
    // the canvas's «save image» menu over it.
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLCanvasElement;
    el.setPointerCapture(e.pointerId);
    // `move` prevents the default, which would otherwise focus the canvas for us.
    el.focus();
    move(e, target);
  }

  function move(e: PointerEvent, target: 'surface' | 'bar'): void {
    const el = e.currentTarget as HTMLCanvasElement;
    if ((e.buttons & 1) === 0 && e.type === 'pointermove') return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    apply(target === 'bar' ? { ...pointer, bar: fx } : surfaceToPointer(model, pointer, fx, fy));
  }

  /* The reference's arrows drove whichever of the two the mouse touched last
     (`bundle:10058-10063`); here each canvas takes focus, so the focused one
     is the one they drive — a field that moved the hue announced nothing. */
  function onSurfaceKey(e: KeyboardEvent): void {
    const next = nudgePointer(model, pointer, e.key, { shift: e.shiftKey, alt: e.altKey, target: 'surface' });
    if (next === pointer) return;
    e.preventDefault();
    apply(next);
  }

  /**
   * Enter and Space close on what is chosen (`bundle:9942-9987`). Esc is the
   * dialog's own `cancel`, and Tab is the dialog's own trap — neither is this
   * function's business any more.
   */
  function onKeydown(e: KeyboardEvent): void {
    const action = pickerKeyAction(e.key, (e.target as HTMLElement | null)?.tagName ?? '');
    if (!action) return;
    if (action === 'commit') commitHex();
    e.stopPropagation();
    requestClose();
  }

  /**
   * The dialog is the window and its backdrop at once: a click on the bare
   * padding between the keys, or past the wheel's rim where the canvas is
   * clipped, also lands on the element. Only a click past its edge is outside.
   */
  function outside(e: MouseEvent): boolean {
    const r = box?.getBoundingClientRect();
    return !r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }

  function dragWindow(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    // The capture would retarget the pointerup and eat the close button's click.
    if ((e.target as HTMLElement).closest('button')) return;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    // Held inside the screen like the studio's other windows: dragged off it,
    // the colour window could only be found again with Esc.
    const onMove = (m: PointerEvent) => {
      if (!box) return;
      const r = box.getBoundingClientRect();
      const base = { left: r.left - offset.x, top: r.top - offset.y };
      const inside = clampWindowPosition(base.left + m.clientX - start.x, base.top + m.clientY - start.y, r, {
        width: innerWidth,
        height: innerHeight,
      });
      offset = { x: inside.left - base.left, y: inside.top - base.top };
    };
    // A drag the browser cancels (a pan, a palm) ends too: left listening, the
    // next touch on the header stacked a second follower on the first.
    const stop = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
  }

  /** Per-pixel fill: 176² calls is nothing next to one canvas draw, and every model draws the same way. */
  function paint(canvas: HTMLCanvasElement | null, kind: 'surface' | 'bar', m: PickerModel, p: Pointer): void {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = canvas;
    const img = ctx.createImageData(width, height);
    // The rgb surface is three channel columns, not two axes: each one ramps
    // its own channel over the other two as they stand (`bundle:10046-10064`).
    const columns = m === 'rgb' && kind === 'surface';
    const base = columns ? hexToRgb(pointerToColor(m, p)) : null;
    const colWidth = width / 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (base) {
          const channel = rgbChannelAt(x / (width - 1));
          const inColumn = x - channel * colWidth;
          // The gaps between the columns stay clear, so three bars read as three.
          if ((channel > 0 && inColumn < COLUMN_GAP) || (channel < 2 && inColumn > colWidth - COLUMN_GAP)) {
            continue;
          }
          const ramp = { ...base, [(['r', 'g', 'b'] as const)[channel]]: Math.round((1 - y / (height - 1)) * 255) };
          img.data[i] = ramp.r;
          img.data[i + 1] = ramp.g;
          img.data[i + 2] = ramp.b;
          img.data[i + 3] = 255;
          continue;
        }
        const at =
          kind === 'bar'
            ? { x: p.x, y: p.y, bar: x / (width - 1) }
            : { x: x / (width - 1), y: y / (height - 1), bar: p.bar };
        const { r, g, b } = hexToRgb(pointerToColor(m, at));
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Where the marker sits: the column centre and channel height in the rgb model. */
  const marker = $derived.by(() => {
    if (model !== 'rgb') return { x: pointer.x, y: pointer.y };
    const channel = pointer.channel ?? 0;
    const value = channel === 0 ? pointer.bar : channel === 1 ? 1 - pointer.y : pointer.x;
    return { x: (channel + 0.5) / 3, y: 1 - value };
  });

  /* A colour set outside the surface — a field, the original swatch, the
     palette — moves the pointer; the surface's own drags do not, so a grey
     does not throw the hue away. */
  $effect(() => {
    if (color === applied) return;
    applied = color;
    pointer = colorToPointer(model, color);
    hexText = color;
  });
  /* What each canvas really shows: the hsv and wheel fields hang on the bar
     alone and the hue strip on nothing, so a drag repaints only the canvas it
     changes — 31 000 pixels a move is a dropped frame on a cheap phone. */
  const surfaceKey = $derived(model === 'rgb' ? pointerToColor(model, pointer) : pointer.bar);
  const barKey = $derived(model === 'hsv' ? '' : `${pointer.x} ${pointer.y}`);
  $effect(() => {
    void surfaceKey;
    paint(surface, 'surface', model, untrack(() => pointer));
  });
  $effect(() => {
    void barKey;
    paint(bar, 'bar', model, barPointer(model, untrack(() => pointer)));
  });

  /** What the field and the bar say to a screen reader, in the model's own terms. */
  const fieldReading = $derived.by(() => {
    if (model === 'rgb') {
      const key = (['r', 'g', 'b'] as const)[pointer.channel ?? 0];
      return { now: rgb[key], max: 255, text: t('picker.field_rgb', { color, channel: t(`picker.channel_${key}`), value: rgb[key] }) };
    }
    if (model === 'wheel') {
      const { h, s } = wheelToHsv(pointer.x * 2 - 1, pointer.y * 2 - 1);
      return { now: s, max: 100, text: t('picker.field_wheel', { color, h, s }) };
    }
    const s = Math.round(pointer.x * 100);
    return { now: s, max: 100, text: t('picker.field_hsv', { color, s, v: Math.round((1 - pointer.y) * 100) }) };
  });
  const barReading = $derived(
    model === 'hsv'
      ? { label: t('picker.hue'), now: Math.round(pointer.bar * 360), max: 360, text: `${Math.round(pointer.bar * 360)}°` }
      : { label: t('picker.value'), now: Math.round(pointer.bar * 100), max: 100, text: `${Math.round(pointer.bar * 100)}%` },
  );
</script>

<!-- A click outside a modal dialog lands on the dialog element itself, because
     the box we paint is the window and everything around it is `::backdrop`.
     That is the click-outside catcher the old `<button>` was standing in for,
     and it needs no element of its own. -->
<svelte:window onresize={keepInside} />

<dialog
  class="picker"
  bind:this={box}
  aria-label={t('picker.title', { label })}
  onkeydown={onKeydown}
  onclick={(e) => e.target === box && outside(e) && requestClose()}
  oncancel={(e) => {
    e.preventDefault();
    requestClose({ revert: true });
  }}
  onclose={() => onclose(intent)}
  style:left="{x}px"
  style:top="{y}px"
  style:transform="translate({offset.x}px, {offset.y}px)"
>
  <header class="head" role="presentation" onpointerdown={dragWindow}>
    <strong>{label}</strong>
    <button class="close" onclick={() => requestClose()} aria-label={t('picker.close')}><Icon name="x" size={16} /></button>
  </header>

  <div class="models" role="group" aria-label={t('picker.models')}>
    {#each [['hsv', 'HSV'], ['rgb', 'RGB'], ['wheel', t('picker.wheel')]] as const as [id, name] (id)}
      <button class:active={model === id} aria-pressed={model === id} onclick={() => setModel(id)}>{name}</button>
    {/each}
  </div>

  <div class="stage">
    <canvas
      class="surface"
      class:wheel={model === 'wheel'}
      bind:this={surface}
      width={SURFACE}
      height={SURFACE}
      role="slider"
      tabindex="0"
      aria-label={t('picker.field')}
      aria-valuetext={fieldReading.text}
      aria-valuenow={fieldReading.now}
      aria-valuemin={0}
      aria-valuemax={fieldReading.max}
      onpointerdown={(e) => drag(e, 'surface')}
      onpointermove={(e) => move(e, 'surface')}
      onkeydown={onSurfaceKey}
    ></canvas>
    <span class="dot" style:left="{marker.x * SURFACE}px" style:top="{marker.y * SURFACE}px"></span>
  </div>

  {#if model !== 'rgb'}
  <div class="stage bar-stage">
    <canvas
      class="bar"
      bind:this={bar}
      width={SURFACE}
      height={BAR_H}
      role="slider"
      tabindex="0"
      aria-label={barReading.label}
      aria-valuetext={barReading.text}
      aria-valuenow={barReading.now}
      aria-valuemin={0}
      aria-valuemax={barReading.max}
      onpointerdown={(e) => drag(e, 'bar')}
      onpointermove={(e) => move(e, 'bar')}
      onkeydown={(e) => {
        const next = nudgePointer(model, pointer, e.key, { shift: e.shiftKey, alt: e.altKey, target: 'bar' });
        if (next !== pointer) (e.preventDefault(), apply(next));
      }}
    ></canvas>
    <span class="knob" style:left="{pointer.bar * SURFACE}px"></span>
  </div>
  {/if}

  <div class="fields">
    {#if model === 'rgb'}
      {#each [['r', 'R'], ['g', 'G'], ['b', 'B']] as const as [key, name] (key)}
        <label>
          <span>{name}</span>
          <input
            aria-label={`${name}, ${t(`picker.channel_${key}`)}`}
            type="number"
            min="0"
            max="255"
            value={rgb[key]}
            oninput={(e) => {
              // An emptied field is on its way to a new number, not a zero.
              const v = e.currentTarget.valueAsNumber;
              if (Number.isFinite(v)) setChannel(key, v);
            }}
            onchange={(e) => {
              // Left empty or past 255, the field shows what the colour holds.
              e.currentTarget.value = String(rgb[key]);
            }}
          />
        </label>
      {/each}
    {/if}
    <label class="hex">
      <span>HEX</span>
      <input
        type="text"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        value={hexText}
        oninput={(e) => typeHex(e.currentTarget.value)}
        onchange={commitHex}
      />
    </label>
  </div>

  <div class="preview">
    <span class="swatch" style:background={color} style:color={contrastInk(color)}>{t('picker.new')}</span>
    <button
      class="swatch old"
      style:background={origin}
      style:color={contrastInk(origin)}
      onclick={() => onpick(origin)}
      title={t('picker.origin_title', { color: origin })}
    >{t('picker.origin')}</button>
  </div>
</dialog>

<style>
  /* 176px of canvas plus a 14px gutter on either side. A modal `<dialog>` is
     centred by the UA with `inset: 0; margin: auto`; this one opens under the
     swatch it belongs to, so the margin goes and the coordinates stay. The top
     layer draws it over everything regardless of `z-index`. */
  .picker {
    position: fixed;
    margin: 0;
    /* 204px holds the canvases; grown text widens the window around them
       instead of pushing «Круг» and the close key out of it, and a window
       taller than the screen scrolls rather than hiding the hex field. */
    min-width: 204px;
    width: fit-content;
    max-width: calc(100% - 12px);
    max-height: calc(100% - 12px);
    overflow: auto;
    display: grid;
    gap: 10px;
    padding: 0 0 12px;
    border: none;
    border-radius: var(--r-md);
    background: var(--canvas);
    color: var(--ink);
    box-shadow: var(--shadow-menu);
  }
  /* The old catcher was an invisible full-screen button, so the page behind
     stayed lit. `::backdrop` takes over the job and keeps the look. */
  .picker::backdrop {
    background: transparent;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.45rem 0.5rem 0.45rem 0.75rem;
    border-bottom: 1px solid var(--hairline);
    cursor: move;
    touch-action: none;
  }
  .head strong {
    font-size: 0.8rem;
    text-transform: capitalize;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    /* The icon is 16px and the padding was 3: a 22px target, under the floor
       and under the standard's own 24. The drawing stays 16; the button is
       the key it always was. */
    min-width: var(--key-h);
    min-height: var(--key-h);
    padding: 0.2rem;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .close:hover {
    background: var(--sub);
    color: var(--ink);
  }
  /* Segmented control: one pill, three equal shares. */
  .models {
    display: grid;
    margin: 0 14px;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    padding: 2px;
    border-radius: var(--r-sm);
    background: var(--sub);
  }
  .models button {
    /* Three segments of a pill, side by side: adjacent targets get no help
       from the standard's spacing clause, so each one carries the floor. */
    min-height: var(--key-h);
    padding: 0.3rem 0;
    border: none;
    border-radius: calc(var(--r-sm) - 1px);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .models button:hover {
    color: var(--ink);
  }
  .models button.active {
    background: var(--canvas);
    color: var(--accent-ink);
  }
  /* The canvas and its pointer share one frame. */
  /* No clipping here: at the edges of the field the pointer hangs half out. */
  .stage {
    position: relative;
    justify-self: center;
    width: 176px;
    margin: 0 14px;
    line-height: 0;
  }
  .bar-stage {
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .surface,
  .bar {
    display: block;
    border-radius: var(--r-sm);
    touch-action: none;
    cursor: crosshair;
  }
  .surface.wheel {
    /* The wheel is square in the maths; the corners outside it are clipped away. */
    border-radius: 50%;
  }
  /* The pointers sit over their canvas without eating its events. */
  .dot {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border: 2px solid var(--canvas);
    border-radius: 50%;
    /* The ring that keeps the pointer visible on a light surface: the table's
       control boundary, not a second black. `--edge` is ink at 48% and was
       written for exactly this — telling a control from what is under it. */
    box-shadow: 0 0 0 1px var(--edge);
    pointer-events: none;
  }
  .knob {
    position: absolute;
    top: 0;
    width: 7px;
    height: 100%;
    margin-left: -3.5px;
    border: 2px solid var(--canvas);
    border-radius: 4px;
    box-shadow: 0 0 0 1px var(--edge);
    pointer-events: none;
  }
  /* The inputs' own default width must not widen the window: the fields take
     what the canvases and the keys leave them. */
  .fields {
    contain: inline-size;
    display: grid;
    margin: 0 14px;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px 6px;
  }
  .fields label {
    display: grid;
    gap: 3px;
  }
  .fields span {
    color: var(--ink-2);
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-align: center;
  }
  .hex {
    grid-column: 1 / -1;
  }
  .fields input {
    width: 100%;
    min-width: 0;
    min-height: var(--key-h);
    padding: 0.25rem 0.2rem;
    border: 1px solid var(--edge);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  /* The spinners steal half the box at this width; the arrows do the nudging. */
  .fields input[type='number'] {
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .fields input::-webkit-outer-spin-button,
  .fields input::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }
  .hex input {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    letter-spacing: 0.04em;
  }
  /* New over original, the way the reference shows the two. */
  .preview {
    display: grid;
    margin: 0 14px;
    grid-template-columns: 1fr 1fr;
    min-height: 34px;
    border-radius: var(--r-sm);
    box-shadow: inset 0 0 0 1px var(--hairline);
    overflow: hidden;
  }
  .swatch {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    font: inherit;
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .old {
    cursor: pointer;
  }
  .old:hover {
    opacity: 1;
  }
  .surface:focus-visible,
  .bar:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  .models button:focus-visible,
  .close:focus-visible,
  .fields input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  /* Inside a swatch the ring is the swatch's own contrast ink (see PaletteBox). */
  .old:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: -2px;
  }
  /* Forced colors drop the box-shadow ring and repaint the border in one
     system colour: on the matching corner of the field the pointer was gone.
     They sit over drawn colour, so they keep their own pair. */
  @media (forced-colors: active) {
    .dot,
    .knob {
      forced-color-adjust: none;
    }
  }
</style>
