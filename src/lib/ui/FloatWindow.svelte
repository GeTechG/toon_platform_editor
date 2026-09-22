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
  import type { Snippet } from 'svelte';
  import type { EditorState } from './editor-state.svelte';
  import { clampWindowPosition } from './draggable';
  import { panelItem } from './panels';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

  let {
    editor,
    id,
    children,
  }: { editor: EditorState; id: string; children: Snippet } = $props();

  let el = $state<HTMLDivElement | undefined>();
  let grab: { x: number; y: number; left: number; top: number } | null = null;

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

  const pos = $derived(editor.floatPos[id] ?? { x: 24, y: 24 });
  const label = $derived(panelItem(id)?.label ?? id);

  function onDown(e: PointerEvent): void {
    // A press on the close key is a press on the key, not a grab of the bar:
    // swallowing it here is what stopped the × from ever firing.
    if (!e.isPrimary || editor.arranging || (e.target as HTMLElement | null)?.closest('button')) {
      return;
    }
    grab = { x: e.clientX, y: e.clientY, left: pos.x, top: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onMove(e: PointerEvent): void {
    if (!grab || !el) {
      return;
    }
    const next = clampWindowPosition(
      grab.left + e.clientX - grab.x,
      grab.top + e.clientY - grab.y,
      { width: el.offsetWidth, height: el.offsetHeight },
      frame(),
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
    if (dx === 0 && dy === 0) {
      return;
    }
    e.preventDefault();
    editor.setFloatPos(id, pos.x + dx, pos.y + dy);
  }
</script>

<svelte:window onresize={reframe} />

<div
  bind:this={el}
  class="float"
  data-item={id}
  style="left: {pos.x}px; top: {pos.y}px"
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="float-bar"
    role="toolbar"
    tabindex="0"
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
      onclick={() => editor.showPanelItem(id)}
      title={t('window.dock_title')}
      aria-label={t('window.dock', { label })}
    >
      <Icon name="x" size={14} />
    </button>
  </div>
  <div class="float-body">
    {@render children()}
  </div>
</div>

<style>
  .float {
    position: absolute;
    /* Over the panels as well as the canvas, under the sheets and the
       arrange bar. */
    z-index: 6;
    display: flex;
    flex-direction: column;
    max-width: min(90%, 28rem);
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    background: var(--canvas);
    /* Lifted off the paper the way a window is, not painted onto it. */
    box-shadow: var(--shadow-plate);
    overflow: hidden;
  }
  .float-bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.15rem 0.15rem 0.15rem 0.6rem;
    background: var(--sky);
    cursor: grab;
    touch-action: none;
  }
  .float-bar:focus-visible {
    outline: 3px solid var(--electric);
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
