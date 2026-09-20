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
  import { insertIndex, type Box } from './arrange';
  import { SLOT_LABELS, panelItem, type PanelLayout, type PanelSlot } from './panels';

  let { editor }: { editor: EditorState } = $props();

  /** The arrangement as it was when this drag began, so Escape can undo it. */
  let before: PanelLayout | null = null;
  let drag = $state<
    | {
        pointerId: number;
        id: string;
        /** Pointer offset inside the item, so a float lands under the hand. */
        dx: number;
        dy: number;
      }
    | null
  >(null);

  const dragLabel = $derived(drag ? panelItem(drag.id)?.label ?? drag.id : '');

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
    before = $state.snapshot(editor.panels);
    drag = { pointerId: e.pointerId, id, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) {
      return;
    }
    e.preventDefault();
    drop(e.clientX, e.clientY, false);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) {
      return;
    }
    drop(e.clientX, e.clientY, true);
    drag = null;
    before = null;
  }

  /** Puts the dragged item where the pointer is; `settle` also writes it down. */
  function drop(x: number, y: number, settle: boolean): void {
    if (!drag) {
      return;
    }
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot]');
    const slot = target?.dataset.slot as PanelSlot | undefined;
    if (!target || !slot) {
      return;
    }
    if (slot === 'float') {
      const stage = target.getBoundingClientRect();
      const left = x - stage.left - drag.dx;
      const top = y - stage.top - drag.dy;
      // Every move would otherwise be a write to storage: the position is
      // kept live and only put down when the hand lets go.
      if (settle) {
        editor.setFloatPos(drag.id, left, top);
      } else {
        editor.floatPos = { ...editor.floatPos, [drag.id]: { x: Math.round(left), y: Math.round(top) } };
      }
      if (!editor.panels.float.includes(drag.id)) {
        editor.movePanelItem(drag.id, 'float');
      }
      return;
    }
    const siblings = [...target.querySelectorAll<HTMLElement>(':scope > [data-item]')]
      .filter((node) => node.dataset.item !== drag?.id);
    const boxes: Box[] = siblings.map((node) => node.getBoundingClientRect());
    const index = insertIndex(boxes, x, y);
    const current = editor.panels[slot].filter((id) => id !== drag?.id);
    if (editor.panels[slot][index] === drag.id || current[index - 1] === drag.id) {
      return; // already there — do not churn the layout under the pointer
    }
    editor.movePanelItem(drag.id, slot, index);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') {
      return;
    }
    e.preventDefault();
    if (drag && before) {
      editor.setPanels(before);
      drag = null;
      before = null;
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

<div class="arrange-bar" role="region" aria-label="Расположение панелей">
  <p class="arrange-hint">
    {#if drag}
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
