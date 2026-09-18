<script lang="ts">
  import { untrack } from 'svelte';
  import { hexToRgb, parseHex, rgbToHex } from './color-model';
  import { colorToPointer, nudgePointer, pointerToColor, type PickerModel, type Pointer } from './picker-model';
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
  $effect(() => paint(bar, 'bar', model, pointer));
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
    {#each [['hsv', 'ТНЯ'], ['rgb', 'RGB'], ['wheel', 'Круг']] as const as [id, name] (id)}
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
      <span>hex</span>
      <input
        type="text"
        maxlength="7"
        bind:value={hexText}
        onchange={commitHex}
        onkeydown={(e) => e.key === 'Enter' && commitHex()}
      />
    </label>
  </div>

  <div class="preview">
    <span class="swatch new" style:background={color}>новый</span>
    <button class="swatch old" style:background={origin} onclick={() => onpick(origin)} title="Вернуть исходный цвет {origin}">
      исходный
    </button>
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
  .picker {
    position: fixed;
    z-index: 41;
    display: grid;
    width: 176px;
    justify-items: center;
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    background: var(--canvas);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }
  .head {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--hairline);
    font-size: 0.85rem;
    cursor: move;
    touch-action: none;
  }
  .close {
    display: flex;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .models {
    display: grid;
    width: 100%;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
  }
  .models button {
    padding: 0.25rem 0;
    border: none;
    border-bottom: 1px solid var(--hairline);
    background: var(--canvas);
    color: var(--ink-2);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .models button.active {
    background: var(--ghost-2);
    color: var(--electric);
  }
  .stage {
    position: relative;
    line-height: 0;
  }
  .surface,
  .bar {
    display: block;
    touch-action: none;
    cursor: crosshair;
  }
  .surface.wheel {
    /* The wheel is square in the maths; the corners outside it are clipped away. */
    border-radius: 50%;
  }
  /* The pointer sits over the surface without eating its events. */
  .dot {
    position: absolute;
    width: 9px;
    height: 9px;
    margin: -5px 0 0 -5px;
    border: 1px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px #000;
    pointer-events: none;
  }
  .fields {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.2rem;
    padding: 0.3rem;
  }
  .fields label {
    display: grid;
    grid-template-columns: 1.2em 1fr;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.7rem;
  }
  .hex {
    grid-column: 1 / -1;
  }
  .fields input {
    width: 100%;
    min-width: 0;
    padding: 0.1rem 0.2rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-size: 0.75rem;
  }
  .preview {
    display: grid;
    width: 100%;
    grid-template-columns: 1fr 1fr;
    height: 28px;
    border-top: 1px solid var(--hairline);
  }
  .swatch {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    color: transparent;
    font-size: 0.65rem;
    overflow: hidden;
  }
  .old {
    cursor: pointer;
  }
  .surface:focus-visible,
  .bar:focus-visible,
  .models button:focus-visible,
  .close:focus-visible,
  .old:focus-visible,
  .fields input:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: -3px;
  }
</style>
