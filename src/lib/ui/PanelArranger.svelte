<script lang="ts">
  /**
   * Arrange mode: drag any item — a tool key, the strip, the palette — from
   * one panel to another, onto the canvas to make it float, or into the tray
   * to put it away. Pointer Events, not HTML5 drag-and-drop, so a touch screen
   * can do it too (same call as LayerRows).
   *
   * This is the only way to rearrange: the settings sheet used to repeat the
   * same moves as selects and arrows, and the list went (nobody used it).
   * Deliberate — drawing needs a pointer anyway, so a keyboard path to the
   * panels lets nobody in who was not already in.
   */
  import { tick } from 'svelte';
  import type { EditorState } from './editor-state.svelte';
  import { saveFile } from './save-file';
  import { arrangeBarBox, dropPlacement, rowEdge, type Box } from './arrange';
  import { newRowSlot, panelItem, slotLabel, slotRow, type PanelSlot } from './panels';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  /** The picker for «Загрузить…»; the visible key clicks it. */
  let workspaceFile = $state<HTMLInputElement | undefined>();

  /** Hands the browser the picked arrangement (or the live one) to save. */
  function downloadWorkspace(): void {
    // Latin, so the name survives any filesystem it lands on.
    saveFile(
      new Blob([editor.exportWorkspace(picked ? Number(picked) : undefined)], {
        type: 'application/json',
      }),
      'layout.json',
    );
  }

  async function onWorkspaceFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      // A wrong file used to change nothing and say nothing.
      const loaded = editor.importWorkspaces(await file.text());
      notice = loaded ? t('arrange.loaded', { n: loaded }) : t('arrange.load_failed');
    }
  }

  /** What the last file load brought, until the hand picks something up. */
  let notice = $state('');

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
  /** The drop would make a row of its own. */
  const newRow = $derived(drag?.moved === true && (slotRow(target?.slot ?? 'left')?.fresh ?? false));
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
    notice = '';
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
    // A window over the canvas is the canvas too: a drop over one, or over
    // the very window being moved, hit no panel and did nothing.
    const hit = document.elementFromPoint(x, y);
    const panelEl = hit?.closest('.float')
      ? document.querySelector<HTMLElement>('[data-slot="float"]')
      : hit?.closest<HTMLElement>('[data-slot]');
    const slot = panelEl?.dataset.slot as PanelSlot | undefined;
    if (!panelEl || !slot) {
      return null;
    }
    const rect = panelEl.getBoundingClientRect();
    const panel = box(rect);
    if (slot === 'float') {
      return { slot, index: 0, line: null, panel };
    }
    // Past the top or bottom edge of a row: a row of its own, made on the
    // drop. No standing gaps between the rows — they would puff the panel up
    // every time anything is moved.
    const row = slotRow(slot);
    const edge = row && !row.fresh ? rowEdge(rect, y) : null;
    if (row && edge) {
      const at = edge === 'before' ? row.index : row.index + 1;
      return {
        slot: newRowSlot(at),
        index: 0,
        line: {
          left: rect.left,
          top: (edge === 'before' ? rect.top : rect.bottom) - 1.5,
          width: rect.width,
          height: 3,
        },
        panel,
      };
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
      // A window is drawn in the editor, not in the canvas: measured from the
      // canvas it landed a column's width off the hand.
      const root = document.querySelector('[data-float-root]')?.getBoundingClientRect();
      editor.setFloatPos(drag.id, x - (root?.left ?? 0) - drag.dx, y - (root?.top ?? 0) - drag.dy);
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

  /**
   * On a phone the bar stood 487px over the panels it rearranges; the named
   * arrangements fold away there, the drag itself needs only the hint, the
   * shelf and «Готово».
   */
  const wideQuery =
    typeof matchMedia === 'function' ? matchMedia('(min-width: 40rem) and (min-height: 32rem)') : null;
  let wide = $state(wideQuery?.matches ?? true);
  $effect(() => {
    const follow = (e: MediaQueryListEvent) => (wide = e.matches);
    wideQuery?.addEventListener('change', follow);
    return () => wideQuery?.removeEventListener('change', follow);
  });

  /**
   * The bar lies on the canvas, clear of the panels it rearranges: fixed
   * over the whole screen it hid the tool row on a phone held upright and
   * both columns on one lying down.
   */
  let barEl = $state<HTMLDivElement | undefined>();
  let place = $state('');
  $effect(() => {
    const stage = document.querySelector<HTMLElement>('[data-slot="float"]');
    if (!stage) {
      return;
    }
    const measure = (): void => {
      const b = arrangeBarBox(stage.getBoundingClientRect(), {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      });
      // No wider than it ever was, centred on a wide canvas.
      place = `left: ${b.left}px; top: ${b.top}px; width: min(46rem, ${b.width}px);`
        + ` margin-left: max(0px, (${b.width}px - 46rem) / 2); max-height: ${b.maxHeight}px; transform: none`;
    };
    const watcher = new ResizeObserver(measure);
    watcher.observe(stage);
    addEventListener('resize', measure);
    return () => {
      watcher.disconnect();
      removeEventListener('resize', measure);
    };
  });

  // The mode opens with the focus on the bar, so a screen reader hears where
  // it is; it closes with the focus on the gear it was opened from — both
  // times it fell to the page.
  $effect(() => {
    barEl?.focus();
    return () => {
      void tick().then(() => {
        if (document.activeElement === document.body || !document.activeElement) {
          document.querySelector<HTMLElement>(`button[aria-label="${t('editor.settings')}"]`)?.focus();
        }
      });
    };
  });

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

<div
  bind:this={barEl}
  class="arrange-bar"
  role="region"
  aria-label={t('arrange.bar')}
  tabindex="-1"
  style={place}
>
  <p class="arrange-hint" aria-live="polite">
    {#if notice}
      {notice}
    {:else if refused}
      {t('arrange.refused', { label: dragLabel })}
    {:else if newRow}
      {t('arrange.new_row', { label: dragLabel })}
    {:else if drag}
      {t('arrange.dragging', { label: dragLabel })}
    {:else}
      {t('arrange.idle')}
    {/if}
  </p>

  <!-- The shelf: everything put away, and a place to drop things onto. -->
  <div class="tray" data-slot="hidden" aria-label={slotLabel('hidden')}>
    <span class="tray-name">{slotLabel('hidden')}</span>
    {#each hidden as item (item.id)}
      <span class="chip" data-item={item.id}>{item.label}</span>
    {/each}
    {#if hidden.length === 0}
      <span class="tray-empty">{t('arrange.tray_empty')}</span>
    {/if}
  </div>

  <div class="arrange-keys">
    <details class="ws" open={wide}>
      <summary class="key">{t('arrange.workspaces')}</summary>
      <div class="ws-keys">
        <!-- Named arrangements: «Планшет», «Стол», whatever the hand wants back. -->
        <select
          class="workspaces"
          aria-label={t('arrange.workspace')}
          value={picked}
          onchange={(e) => {
            picked = e.currentTarget.value;
            if (picked) {
              editor.applyWorkspace(Number(picked));
            }
          }}
        >
          <option value="">{t('arrange.workspace_none')}</option>
          {#each editor.workspaces as workspace (workspace.id)}
            <option value={String(workspace.id)}>{workspace.name}</option>
          {/each}
        </select>
        <input
          class="ws-name"
          type="text"
          placeholder={t('arrange.name_placeholder')}
          aria-label={t('arrange.name_label')}
          bind:value={newName}
          onkeydown={(e) => e.key === 'Enter' && saveAs()}
        />
        <button class="key" disabled={!newName.trim()} onclick={saveAs} title={t('arrange.save_title')}>
          {t('arrange.save')}
        </button>
        <button
          class="key danger"
          disabled={!picked}
          onclick={() => {
            editor.deleteWorkspace(Number(picked));
            picked = '';
          }}
          title={t('arrange.delete_title')}
        >{t('arrange.delete')}</button>
        <button class="key" onclick={downloadWorkspace} title={t('arrange.download_title')}>
          {t('arrange.download')}
        </button>
        <button class="key" onclick={() => workspaceFile?.click()} title={t('arrange.upload_title')}>
          {t('arrange.upload')}
        </button>
        <input
          bind:this={workspaceFile}
          type="file"
          hidden
          accept="application/json,.json"
          aria-label={t('arrange.file')}
          onchange={onWorkspaceFile}
        />
        <button class="key" onclick={() => editor.resetPanels()} title={t('arrange.reset_title')}>
          {t('arrange.reset')}
        </button>
      </div>
    </details>
    <button class="key primary" onclick={() => (editor.arranging = false)}>
      {t('arrange.done')}
    </button>
  </div>
</div>

<style>
  .ghost,
  .drop-line,
  .drop-panel {
    position: fixed;
    z-index: var(--z-drop);
    pointer-events: none;
  }
  .ghost {
    padding: 0.2rem 0.55rem;
    border-radius: var(--r-pill);
    background: var(--accent);
    color: var(--canvas);
    font-size: 0.82rem;
    font-weight: 650;
    white-space: nowrap;
    box-shadow: var(--shadow-menu);
  }
  .drop-line {
    border-radius: 2px;
    background: var(--accent);
  }
  @media (forced-colors: active) {
    .drop-line {
      background: CanvasText;
    }
  }
  /* The panel that would take it, so a drop is never a guess. */
  .drop-panel {
    border: 2px solid var(--accent);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  /* A strip over the editor, not a dialog: the panels behind it stay usable
     as drop targets, which is the whole point of the mode. */
  .arrange-bar {
    position: fixed;
    left: 50%;
    top: 1rem;
    z-index: var(--z-arrange);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    /* Fixed: `100%` is the initial containing block, scrollbar excluded. */
    width: min(46rem, calc(100% - 2rem));
    /* At 200% text it stood taller than a phone, «Готово» under the edge. */
    max-height: calc(100% - 2rem);
    overflow-y: auto;
    padding: 0.7rem 0.8rem;
    border: none;
    border-radius: var(--r-md);
    /* Paper, as the soundtrack plate: told from the white sheet under it by
       tone (no soft shadow on a plate), and a white key on it has its form
       again — on white, «Сохранить» and «Скачать» read as bare words. */
    background: var(--paper);
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
    /* A finger picks these up off the shelf; 24px was the bare minimum. */
    display: inline-flex;
    align-items: center;
    min-height: 2.25rem;
    padding: 0.2rem 0.6rem;
    border: none;
    border-radius: var(--r-pill);
    background: var(--sub);
    font-size: 0.82rem;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .arrange-keys {
    /* «Готово» stays in view while the bar scrolls inside itself. */
    position: sticky;
    bottom: -0.7rem;
    margin-bottom: -0.7rem;
    padding-bottom: 0.7rem;
    background: var(--paper);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .ws {
    margin-right: auto;
  }
  @media (max-width: 39.99rem), (max-height: 31.99rem) {
    .ws[open] {
      flex-basis: 100%;
    }
  }
  .ws-keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .ws[open] .ws-keys {
    margin-top: 0.4rem;
  }
  /* Under the bar's class too: the studio's `.editor .key` weighs two. */
  .arrange-bar .ws > summary {
    display: inline-flex;
    align-items: center;
    list-style: none;
  }
  .ws > summary::-webkit-details-marker {
    display: none;
  }
  /* A wide screen has the room: the keys stand open with no fold key. */
  @media (min-width: 40rem) and (min-height: 32rem) {
    .arrange-bar .ws > summary {
      display: none;
    }
    .ws {
      flex: 1;
    }
    .ws[open] .ws-keys {
      margin-top: 0;
    }
  }
  .ws-name {
    min-height: var(--key-h);
    width: 8rem;
    padding: 0 0.5rem;
    border: 1px solid var(--edge);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: inherit;
    font: inherit;
  }
  .workspaces {
    min-height: var(--key-h);
    margin-right: auto;
    /* «— рабочее пространство —» itself needs ~15rem; 14 cut its last word. */
    max-width: 16rem;
  }
</style>
