<script lang="ts">
  /**
   * Arrange mode: drag any item — a tool key, the strip, the palette — from
   * one panel to another, onto the canvas to make it float, or into the tray
   * to put it away. Pointer Events, not HTML5 drag-and-drop, so a touch screen
   * can do it too (same call as LayerRows).
   *
   * Nothing here is the only way to rearrange: the settings sheet holds the
   * same moves as selects and arrows (WCAG 2.2 AA 2.5.7).
   */
  import type { EditorState } from './editor-state.svelte';
  import { dropPlacement, type Box } from './arrange';
  import { SLOT_LABELS, panelItem, type PanelSlot } from './panels';

  let { editor }: { editor: EditorState } = $props();

  /** How far the pointer travels before a press counts as a drag, in px. */
  const DRAG_THRESHOLD = 4;

  interface Drag {
    pointerId: number;
    id: string;
    /** Where the press started, for the threshold. */
    fromX: number;
    fromY: number;
    /** Pointer offset inside the item, so a float lands under the hand. */
    dx: number;
    dy: number;
    /** Live pointer position — the ghost follows it. */
    x: number;
    y: number;
    /** Past the threshold: the ghost and the line are up. */
    moved: boolean;
  }

  /** Where the item would land if the hand let go now. */
  interface Target {
    slot: PanelSlot;
    index: number;
    /** Viewport rectangle for the drop line, or the panel to outline. */
    line: { left: number; top: number; width: number; height: number } | null;
    panel: { left: number; top: number; width: number; height: number };
  }

  let drag = $state<Drag | null>(null);
  let target = $state<Target | null>(null);

  const dragLabel = $derived(drag ? panelItem(drag.id)?.label ?? drag.id : '');
  /** Dropping the gear on the shelf does nothing, so the hint says why. */
  const refused = $derived(
    drag !== null && target?.slot === 'hidden' && (panelItem(drag.id)?.keep ?? false),
  );

  function onPointerDown(e: PointerEvent): void {
    if (!e.isPrimary || drag) {
      return;
    }
    const handle = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-item]');
    const id = handle?.dataset.item;
    if (!handle || !id) {
      return;
    }
    const rect = handle.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId,
      id,
      fromX: e.clientX,
      fromY: e.clientY,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) {
      return;
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.moved) {
      const far = Math.abs(e.clientX - drag.fromX) > DRAG_THRESHOLD
        || Math.abs(e.clientY - drag.fromY) > DRAG_THRESHOLD;
      if (!far) {
        return;
      }
      drag.moved = true;
    }
    e.preventDefault();
    // Nothing in the panels moves while the hand is travelling: re-sorting
    // them under the pointer changes what is nearest and the item jitters
    // between two places. Only the ghost and the line follow.
    target = aim(e.clientX, e.clientY);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) {
      return;
    }
    if (drag.moved && target) {
      settle(target, e.clientX, e.clientY);
    }
    drag = null;
    target = null;
  }

  /** The drop the pointer is over now — measured, never applied. */
  function aim(x: number, y: number): Target | null {
    if (!drag) {
      return null;
    }
    const panelEl = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot]');
    const slot = panelEl?.dataset.slot as PanelSlot | undefined;
    if (!panelEl || !slot) {
      return null;
    }
    const panel = box(panelEl.getBoundingClientRect());
    if (slot === 'float') {
      return { slot, index: 0, line: null, panel };
    }
    const siblings = [...panelEl.querySelectorAll<HTMLElement>(':scope > [data-item]')]
      .filter((node) => node.dataset.item !== drag?.id);
    const boxes: Box[] = siblings.map((node) => node.getBoundingClientRect());
    const placement = dropPlacement(boxes, x, y);
    if (!placement.box) {
      return { slot, index: 0, line: null, panel };
    }
    const b = placement.box;
    const vertical = placement.edge === 'left' || placement.edge === 'right';
    return {
      slot,
      index: placement.index,
      line: vertical
        ? { left: (placement.edge === 'left' ? b.left : b.right) - 1.5, top: b.top, width: 3, height: b.bottom - b.top }
        : { left: b.left, top: (placement.edge === 'top' ? b.top : b.bottom) - 1.5, width: b.right - b.left, height: 3 },
      panel,
    };
  }

  /** One move, once, when the hand lets go. */
  function settle(to: Target, x: number, y: number): void {
    if (!drag) {
      return;
    }
    if (to.slot === 'float') {
      editor.setFloatPos(drag.id, x - to.panel.left - drag.dx, y - to.panel.top - drag.dy);
      if (!editor.panels.float.includes(drag.id)) {
        editor.movePanelItem(drag.id, 'float');
      }
      return;
    }
    editor.movePanelItem(drag.id, to.slot, to.index);
  }

  function box(rect: DOMRect): { left: number; top: number; width: number; height: number } {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') {
      return;
    }
    e.preventDefault();
    if (drag) {
      // Nothing was applied, so letting go of the drag is the whole undo.
      drag = null;
      target = null;
      return;
    }
    editor.arranging = false;
  }

  const hidden = $derived(editor.panels.hidden.map((id) => ({ id, label: panelItem(id)?.label ?? id })));

  /** The workspace picked in the list; '' while none is. */
  let picked = $state('');

  /** Name being typed for the next save. */
  let newName = $state('');

  function saveAs(): void {
    const name = newName.trim();
    if (!name) {
      return;
    }
    editor.saveWorkspace(name);
    picked = String(editor.workspaces.find((w) => w.name === name)?.id ?? '');
    newName = '';
  }
</script>

<svelte:window
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onkeydown={onKeydown}
/>

{#if drag?.moved}
  <!-- The ghost under the hand and the line where it would land; both are
       see-through to the pointer, so the hit test reads the panels. -->
  <span class="ghost" style="left: {drag.x + 12}px; top: {drag.y + 12}px">{dragLabel}</span>
  {#if target}
    <div
      class="drop-panel"
      style="left: {target.panel.left}px; top: {target.panel.top}px; width: {target.panel.width}px; height: {target.panel.height}px"
    ></div>
    {#if target.line}
      <div
        class="drop-line"
        style="left: {target.line.left}px; top: {target.line.top}px; width: {target.line.width}px; height: {target.line.height}px"
      ></div>
    {/if}
  {/if}
{/if}

<div class="arrange-bar" role="region" aria-label="Расположение панелей">
  <p class="arrange-hint">
    {#if refused}
      «{dragLabel}» убрать нельзя — это дорога назад к настройкам; перенеси в панель
    {:else if drag}
      Переносим «{dragLabel}» — отпусти над панелью, холстом или полкой
    {:else}
      Перетаскивай что угодно: в другую панель, на холст (будет окном) или на полку
    {/if}
  </p>

  <!-- The shelf: everything put away, and a place to drop things onto. -->
  <div class="tray" data-slot="hidden" aria-label={SLOT_LABELS.hidden}>
    <span class="tray-name">{SLOT_LABELS.hidden}</span>
    {#each hidden as item (item.id)}
      <span class="chip" data-item={item.id}>{item.label}</span>
    {/each}
    {#if hidden.length === 0}
      <span class="tray-empty">пусто — перетащи сюда, чтобы убрать</span>
    {/if}
  </div>

  <div class="arrange-keys">
    <!-- Named arrangements: «Планшет», «Стол», whatever the hand wants back. -->
    <select
      class="workspaces"
      aria-label="Рабочее пространство"
      value={picked}
      onchange={(e) => {
        picked = e.currentTarget.value;
        if (picked) {
          editor.applyWorkspace(Number(picked));
        }
      }}
    >
      <option value="">— рабочее пространство —</option>
      {#each editor.workspaces as workspace (workspace.id)}
        <option value={String(workspace.id)}>{workspace.name}</option>
      {/each}
    </select>
    <input
      class="ws-name"
      type="text"
      placeholder="название"
      aria-label="Название рабочего пространства"
      bind:value={newName}
      onkeydown={(e) => e.key === 'Enter' && saveAs()}
    />
    <button class="key" disabled={!newName.trim()} onclick={saveAs} title="Сохранить текущую раскладку под именем">
      Сохранить
    </button>
    <button
      class="key danger"
      disabled={!picked}
      onclick={() => {
        editor.deleteWorkspace(Number(picked));
        picked = '';
      }}
      title="Удалить выбранное пространство"
    >Удалить</button>
    <button class="key" onclick={() => editor.resetFeatures()} title="Вернуть раскладку набора">
      Сбросить
    </button>
    <button class="key primary" onclick={() => (editor.arranging = false)}>
      Готово
    </button>
  </div>
</div>

<style>
  .ghost,
  .drop-line,
  .drop-panel {
    position: fixed;
    z-index: 40;
    pointer-events: none;
  }
  .ghost {
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    background: var(--electric);
    color: var(--canvas);
    font-size: 0.82rem;
    font-weight: 650;
    white-space: nowrap;
    box-shadow: 0 6px 16px rgba(15, 23, 60, 0.3);
  }
  .drop-line {
    border-radius: 2px;
    background: var(--electric);
  }
  /* The panel that would take it, so a drop is never a guess. */
  .drop-panel {
    border: 2px solid var(--electric);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--electric) 8%, transparent);
  }
  /* A strip over the editor, not a dialog: the panels behind it stay usable
     as drop targets, which is the whole point of the mode. */
  .arrange-bar {
    position: fixed;
    left: 50%;
    top: 1rem;
    z-index: 30;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: min(46rem, calc(100vw - 2rem));
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    background: var(--canvas);
    box-shadow: 0 14px 30px rgba(15, 23, 60, 0.22);
  }
  .arrange-hint {
    margin: 0;
    font-size: 0.88rem;
    color: var(--ink-2);
  }
  .tray {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.6rem;
    padding: 0.35rem;
    border: 1px dashed var(--hairline);
    border-radius: var(--r-sm);
  }
  .tray-name {
    font-size: 0.8rem;
    font-weight: 650;
    color: var(--ink-2);
  }
  .tray-empty {
    font-size: 0.82rem;
    color: var(--ink-2);
  }
  .chip {
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: var(--sky);
    font-size: 0.82rem;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .arrange-keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .ws-name {
    min-height: var(--key-h);
    width: 8rem;
    padding: 0 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: inherit;
    font: inherit;
  }
  .workspaces {
    min-height: var(--key-h);
    margin-right: auto;
    max-width: 14rem;
    padding: 0 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: inherit;
    font: inherit;
  }
</style>
