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
  import { tick, untrack, type Snippet } from 'svelte';
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

  /** Puts the window back inside after the editor changed size. */
  function reframe(): void {
    if (!el) {
      return;
    }
    const inside = clampWindowPosition(
      pos.x,
      pos.y,
      { width: el.offsetWidth, height: el.offsetHeight },
      frame(),
    );
    if (inside.left !== pos.x || inside.top !== pos.y) {
      editor.setFloatPos(id, inside.left, inside.top);
    }
  }

  // A window that grows (the strip gaining frames), or was just dropped near
  // an edge, comes back inside too — not only when the browser window resizes.
  $effect(() => {
    if (!el) {
      return;
    }
    const watcher = new ResizeObserver(() => reframe());
    watcher.observe(el);
    if (el.offsetParent) {
      watcher.observe(el.offsetParent);
    }
    return () => watcher.disconnect();
  });

  const pos = $derived(editor.floatPos[id] ?? { x: 24, y: 24 });

  // …and so does one put anywhere by anyone: a drop past the edge, or a
  // workspace saved on a wider screen, changes the place and not the size,
  // and the observer above never heard of it.
  $effect(() => {
    void pos.x;
    void pos.y;
    untrack(reframe);
  });

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
    const panel = document.querySelector<HTMLElement>(`[data-slot="${at.slot}"]`);
    const item = panel?.children[at.index] as HTMLElement | undefined;
    const focusable = 'button, input, select, [tabindex]';
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
    // The window pressed comes to the front: the last one drawn is on top,
    // and one wholly under another could not be reached at all.
    const floats = editor.panels.float;
    if (floats[floats.length - 1] !== id) {
      editor.movePanelItem(id, 'float');
      // Moving the node lets go of the capture; take it again once it is back.
      const bar = e.currentTarget as HTMLElement;
      void tick().then(() => {
        try {
          if (grab) bar.setPointerCapture(e.pointerId);
        } catch {
          // The pointer is already up — nothing to follow.
        }
      });
    }
    grab = {
      x: e.clientX,
      y: e.clientY,
      left: pos.x,
      top: pos.y,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      bounds: frame(),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onMove(e: PointerEvent): void {
    if (!grab) {
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

  function onUp(): void {
    grab = null;
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
      pos.x + dx,
      pos.y + dy,
      { width: el.offsetWidth, height: el.offsetHeight },
      frame(),
    );
    editor.setFloatPos(id, next.left, next.top);
  }
</script>

<div
  bind:this={el}
  class="float"
  class:handle={editor.arranging}
  data-item={id}
  style="left: {pos.x}px; top: {pos.y}px"
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
