<script lang="ts">
  /**
   * An item taken off the panels and put over the canvas: the reference's own
   * floating tool windows, but for anything — the palette, the strip, the
   * transport. Dragged by its title bar and kept inside the stage.
   *
   * While the editor is in arrange mode the whole window is a drag handle for
   * the arranger instead (it is what puts it back into a panel), so the title
   * bar stands down.
   */
  import { tick, type Snippet } from 'svelte';
  import type { EditorState } from './editor-state.svelte';
  import { clampWindowPosition } from './draggable';
  import { panelItem, slotOf } from './panels';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

  let {
    editor,
    id,
    children,
  }: { editor: EditorState; id: string; children: Snippet } = $props();

  let el = $state<HTMLDivElement | undefined>();
  /** The size and the stage are read once, on the press: neither changes during a drag. */
  let grab: {
    /** The finger that took it: a second one on the bar steered it too. */
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    size: { width: number; height: number };
    bounds: { width: number; height: number };
  } | null = null;

  /** The editor, which is what the window's coordinates are measured against. */
  function frame(): { width: number; height: number } {
    const root = el?.offsetParent as HTMLElement | null;
    return { width: root?.clientWidth ?? 0, height: root?.clientHeight ?? 0 };
  }

  /** The window's own size and the editor's, as last seen by the observer. */
  let size = $state({ width: 0, height: 0 });
  let bounds = $state({ width: 0, height: 0 });

  // A window that grows (the strip gaining frames), or an editor that
  // shrinks, is measured again — not only when the browser window resizes.
  $effect(() => {
    if (!el) {
      return;
    }
    const watcher = new ResizeObserver(() => {
      if (el) {
        size = { width: el.offsetWidth, height: el.offsetHeight };
        bounds = frame();
      }
    });
    watcher.observe(el);
    if (el.offsetParent) {
      watcher.observe(el.offsetParent);
    }
    return () => watcher.disconnect();
  });

  const pos = $derived(editor.floatPos[id] ?? { x: 24, y: 24 });

  /**
   * Where the window is drawn: its place, brought inside the editor — a drop
   * past the edge, a workspace saved on a wider screen, a phone turned.
   * Drawn, never stored: written back, one visit on a narrow window (the
   * keyboard up, a split screen) moved every window for good. A hidden
   * editor measures nothing and leaves the place alone.
   */
  const shown = $derived(
    bounds.width > 0 && bounds.height > 0
      ? clampWindowPosition(pos.x, pos.y, size, bounds)
      : { left: pos.x, top: pos.y },
  );

  /**
   * Stacking order is the order of `panels.float`, drawn as a z-index: the
   * nodes stay put, so raising one keeps the focus and the pointer capture in
   * it. Five rungs between the windows and the sheets; any deeper window
   * shares the lowest.
   */
  const depth = $derived(
    Math.max(0, 4 - (editor.panels.float.length - 1 - editor.panels.float.indexOf(id))),
  );

  /** The window in use comes to the front: pressed anywhere, or Tab reaching into it. */
  function raise(): void {
    const floats = editor.panels.float;
    if (!editor.arranging && floats[floats.length - 1] !== id) {
      editor.movePanelItem(id, 'float');
    }
  }

  /**
   * The window goes back into its panel, and the focus goes with it to the
   * key it became: the × it was on is gone, and the focus fell to the page.
   */
  async function dock(): Promise<void> {
    editor.showPanelItem(id);
    const at = slotOf(editor.panels, id);
    await tick();
    if (!at) {
      return;
    }
    // It lands at the end of its panel. Found by index it was not: a key that
    // draws nothing (publish off the site) shifted it onto a neighbour.
    const panel = document.querySelector<HTMLElement>(`[data-slot="${at.slot}"]`);
    const item = panel?.lastElementChild as HTMLElement | null | undefined;
    // A disabled «Отменить» takes no focus, and it fell to the page.
    const focusable =
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const key = item?.matches(focusable) ? item : item?.querySelector<HTMLElement>(focusable);
    (key ?? panel?.querySelector<HTMLElement>(focusable))?.focus();
  }
  const label = $derived(panelItem(id)?.label ?? id);

  function onDown(e: PointerEvent): void {
    // A press on the close key is a press on the key, not a grab of the bar:
    // swallowing it here is what stopped the × from ever firing.
    if (!e.isPrimary || editor.arranging || (e.target as HTMLElement | null)?.closest('button')) {
      return;
    }
    if (!el) {
      return;
    }
    // Raised by the capture listener on the whole window, before this.
    grab = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: shown.left,
      top: shown.top,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      bounds: frame(),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onMove(e: PointerEvent): void {
    if (!grab || e.pointerId !== grab.pointerId) {
      return;
    }
    const next = clampWindowPosition(
      grab.left + e.clientX - grab.x,
      grab.top + e.clientY - grab.y,
      grab.size,
      grab.bounds,
    );
    editor.setFloatPos(id, next.left, next.top);
  }

  function onUp(e: PointerEvent): void {
    if (grab?.pointerId === e.pointerId) {
      grab = null;
    }
  }

  /** Arrow keys move it too — a drag must never be the only way (WCAG 2.5.7). */
  function onKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 20 : 4;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    if ((dx === 0 && dy === 0) || !el) {
      return;
    }
    e.preventDefault();
    const next = clampWindowPosition(
      shown.left + dx,
      shown.top + dy,
      { width: el.offsetWidth, height: el.offsetHeight },
      frame(),
    );
    editor.setFloatPos(id, next.left, next.top);
  }
</script>

<!-- Raising is not an action of its own: the press or the focus is. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={el}
  class="float"
  class:handle={editor.arranging}
  data-item={id}
  style="left: {shown.left}px; top: {shown.top}px; z-index: calc(var(--z-float) + {depth})"
  onpointerdowncapture={raise}
  onfocusin={raise}
>
  <!-- A named group the arrows move, not a toolbar: a toolbar's arrows
       travel between its items, and these move the window. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="float-bar"
    role="group"
    tabindex="0"
    inert={editor.arranging}
    aria-label={t('window.drag', { label })}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onkeydown={onKey}
  >
    <span class="float-name">{label}</span>
    <button
      class="key icon"
      onclick={dock}
      title={t('window.dock_title')}
      aria-label={t('window.dock', { label })}
    >
      <Icon name="x" size={14} />
    </button>
  </div>
  <!-- While arranging, the whole window is the handle: nothing in it presses. -->
  <div class="float-body" inert={editor.arranging}>
    {@render children()}
  </div>
</div>

<style>
  .float {
    position: absolute;
    /* Over the panels as well as the canvas, under the sheets and the
       arrange bar. */
    z-index: var(--z-float);
    display: flex;
    flex-direction: column;
    max-width: min(90%, 28rem);
    border: none;
    border-radius: var(--r-md);
    /* Paper, as the zoom window: a white window on the white sheet had no
       edge at all once the ring went (stage-windows-by-tone). */
    background: var(--paper);
    overflow: hidden;
  }
  /* While arranging it is a handle like every item in the panels, and wears
     the same dashed frame — it wore none, and did not read as movable. */
  .float.handle {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
    cursor: grab;
  }
  .float-bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.15rem 0.15rem 0.15rem 0.6rem;
    background: var(--sub);
    cursor: grab;
    touch-action: none;
  }
  .float-bar:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  .float-name {
    flex: 1;
    min-width: 0;
    font-size: 0.82rem;
    font-weight: 650;
    color: var(--ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Forced colours paint the paper as the canvas under it: no edge left. */
  @media (forced-colors: active) {
    .float {
      outline: 1px solid CanvasText;
    }
  }
  .float-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem;
    max-height: 60vh;
    overflow: auto;
  }
</style>
