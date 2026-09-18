<script lang="ts">
  import { untrack } from 'svelte';
  import { hexToRgb, parseHex, rgbToHex } from './color-model';
  import { barPointer, colorToPointer, nudgePointer, pointerToColor, type PickerModel, type Pointer } from './picker-model';
  import { contrastInk } from './color-palette';
  import Icon from './Icon.svelte';

  let {
    color,
    label,
    x,
    y,
    onpick,
    onclose,
  }: {
    color: string;
    label: string;
    /** Viewport coordinates the window opens at (it is fixed, then draggable). */
    x: number;
    y: number;
    onpick: (hex: string) => void;
    onclose: () => void;
  } = $props();

  /** Reference #colour_picker: a 176×176 surface over a 176×31 bar. */
  const SURFACE = 176;
  const BAR_H = 31;

  const origin = untrack(() => color);
  let model = $state<PickerModel>('hsv');
  let pointer = $state<Pointer>(untrack(() => colorToPointer('hsv', color)));
  /** Last colour this window produced — anything else came from outside. */
  let applied = $state(origin);
  let surface = $state<HTMLCanvasElement | null>(null);
  let bar = $state<HTMLCanvasElement | null>(null);
  let box = $state<HTMLElement | null>(null);
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
    model = next;
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

  /** Pointer events cover mouse and touch alike; the capture keeps the drag alive outside. */
  function drag(e: PointerEvent, target: 'surface' | 'bar'): void {
    const el = e.currentTarget as HTMLCanvasElement;
    el.setPointerCapture(e.pointerId);
    // `move` prevents the default, which would otherwise focus the canvas for us.
    el.focus();
    move(e, target);
  }

  function move(e: PointerEvent, target: 'surface' | 'bar'): void {
    const el = e.currentTarget as HTMLCanvasElement;
    if (e.buttons === 0 && e.type === 'pointermove') return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    apply(target === 'bar' ? { ...pointer, bar: fx } : { ...pointer, x: fx, y: fy });
  }

  function onSurfaceKey(e: KeyboardEvent): void {
    const next = nudgePointer(model, pointer, e.key, { shift: e.shiftKey, alt: e.altKey });
    if (next === pointer) return;
    e.preventDefault();
    apply(next);
  }

  /** Esc closes; Tab stays inside the window (reference: the picker is modal-ish). */
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
      return;
    }
    if (e.key !== 'Tab' || !box) return;
    const items = [...box.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')].filter((el) => !el.hasAttribute('disabled'));
    if (items.length === 0) return;
    const edge = e.shiftKey ? items[0] : items[items.length - 1];
    if (document.activeElement === edge) {
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  }

  function dragWindow(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    // The capture would retarget the pointerup and eat the close button's click.
    if ((e.target as HTMLElement).closest('button')) return;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    const onMove = (m: PointerEvent) => (offset = { x: m.clientX - start.x, y: m.clientY - start.y });
    const stop = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', stop);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', stop);
  }

  /** Per-pixel fill: 176² calls is nothing next to one canvas draw, and every model draws the same way. */
  function paint(canvas: HTMLCanvasElement | null, kind: 'surface' | 'bar', m: PickerModel, p: Pointer): void {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = canvas;
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at =
          kind === 'bar'
            ? { x: p.x, y: p.y, bar: x / (width - 1) }
            : { x: x / (width - 1), y: y / (height - 1), bar: p.bar };
        const { r, g, b } = hexToRgb(pointerToColor(m, at));
        const i = (y * width + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* A colour set outside the surface — a field, the original swatch, the
     palette — moves the pointer; the surface's own drags do not, so a grey
     does not throw the hue away. */
  $effect(() => {
    if (color === applied) return;
    applied = color;
    pointer = colorToPointer(model, color);
    hexText = color;
  });
  $effect(() => paint(surface, 'surface', model, pointer));
  $effect(() => paint(bar, 'bar', model, barPointer(model, pointer)));
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Click-outside catcher; the picker itself sits above it. -->
<button class="backdrop" aria-label="Закрыть выбор цвета" onclick={onclose}></button>

<div
  class="picker"
  bind:this={box}
  role="dialog"
  aria-label="Выбор цвета: {label}"
  style:left="{x}px"
  style:top="{y}px"
  style:transform="translate({offset.x}px, {offset.y}px)"
>
  <header class="head" role="presentation" onpointerdown={dragWindow}>
    <strong>{label}</strong>
    <button class="close" onclick={onclose} aria-label="Закрыть"><Icon name="x" size={16} /></button>
  </header>

  <div class="models" role="group" aria-label="Модель цвета">
    {#each [['hsv', 'HSV'], ['rgb', 'RGB'], ['wheel', 'Wheel']] as const as [id, name] (id)}
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
      aria-label="Поле цвета: стрелки — на единицу, Shift — на десять, Alt — по полосе"
      aria-valuetext="{color}, поле {Math.round(pointer.x * 100)} на {Math.round((1 - pointer.y) * 100)}"
      aria-valuenow={Math.round(pointer.x * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onpointerdown={(e) => drag(e, 'surface')}
      onpointermove={(e) => move(e, 'surface')}
      onkeydown={onSurfaceKey}
    ></canvas>
    <span class="dot" style:left="{pointer.x * SURFACE}px" style:top="{pointer.y * SURFACE}px"></span>
  </div>

  <div class="stage bar-stage">
    <canvas
      class="bar"
      bind:this={bar}
      width={SURFACE}
      height={BAR_H}
      role="slider"
      tabindex="0"
      aria-label="Полоса"
      aria-valuenow={Math.round(pointer.bar * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onpointerdown={(e) => drag(e, 'bar')}
      onpointermove={(e) => move(e, 'bar')}
      onkeydown={(e) => {
        const next = nudgePointer(model, pointer, e.key, { shift: e.shiftKey, alt: true });
        if (next !== pointer) (e.preventDefault(), apply(next));
      }}
    ></canvas>
    <span class="knob" style:left="{pointer.bar * SURFACE}px"></span>
  </div>

  <div class="fields">
    {#each [['r', 'R'], ['g', 'G'], ['b', 'B']] as const as [key, name] (key)}
      <label>
        <span>{name}</span>
        <input
          type="number"
          min="0"
          max="255"
          value={rgb[key]}
          oninput={(e) => setChannel(key, Number(e.currentTarget.value))}
        />
      </label>
    {/each}
    <label class="hex">
      <span>HEX</span>
      <input
        type="text"
        maxlength="7"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        bind:value={hexText}
        onchange={commitHex}
        onkeydown={(e) => e.key === 'Enter' && commitHex()}
      />
    </label>
  </div>

  <div class="preview">
    <span class="swatch" style:background={color} style:color={contrastInk(color)}>новый</span>
    <button
      class="swatch old"
      style:background={origin}
      style:color={contrastInk(origin)}
      onclick={() => onpick(origin)}
      title="Вернуть исходный цвет {origin}"
    >исходный</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    border: none;
    background: transparent;
    cursor: default;
  }
  /* 176px of canvas plus a 14px gutter on either side. */
  .picker {
    position: fixed;
    z-index: 41;
    display: grid;
    width: 204px;
    gap: 10px;
    padding-bottom: 12px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    background: var(--canvas);
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.28);
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
    padding: 0.2rem;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .close:hover {
    background: var(--sky);
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
    background: var(--sky);
  }
  .models button {
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
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
    color: var(--electric);
  }
  /* The canvas and its pointer share one frame. */
  /* No clipping here: at the edges of the field the pointer hangs half out. */
  .stage {
    position: relative;
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
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 1px 3px rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }
  .knob {
    position: absolute;
    top: 0;
    width: 7px;
    height: 100%;
    margin-left: -3.5px;
    border: 2px solid #fff;
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }
  .fields {
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
    font-size: 0.6rem;
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
    padding: 0.25rem 0.2rem;
    border: 1px solid var(--hairline);
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
    height: 34px;
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
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    opacity: 0.85;
  }
  .old {
    cursor: pointer;
  }
  .old:hover {
    opacity: 1;
  }
  .surface:focus-visible,
  .bar:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: -3px;
  }
  .models button:focus-visible,
  .close:focus-visible,
  .old:focus-visible,
  .fields input:focus-visible {
    outline: 2px solid var(--electric);
    outline-offset: -2px;
  }
</style>
