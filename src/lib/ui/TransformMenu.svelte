<script lang="ts">
  /**
   * The reference transform window (toonio.bundle.js `Lasso`): one numeric
   * field per parameter, the two mirrors, the width checkbox, a step back and
   * forth inside the session, and apply / cancel.
   *
   * Every control writes through the state, which is also where the hotkeys
   * and the canvas handles land — so the fields and the drag never disagree.
   */
  import type { EditorState } from './editor-state.svelte';
  import Icon from './Icon.svelte';
  import { draggable } from './draggable';
  import { formatPercent, t } from '../i18n';
  import { scaleFromField } from '../tools/lasso';
  import { ZOOM_MAX, ZOOM_MIN, zoomDelta } from './viewport';
  import { FIXED_POINT_SCALE } from '../format/constants';

  let { editor }: { editor: EditorState } = $props();

  const session = $derived(editor.transform?.session);

  /**
   * A field edit is an absolute value, not a step — it replaces that one axis.
   * An emptied field, or a lone "-" on the way to a negative one, is NaN and
   * writes nothing: read as 0 it threw the selection to the edge.
   *
   * A number typed key by key is one step of the session, not one per key:
   * the field being typed into replaces its own step until it is left
   * (`change`). A spinner click is an input and a change, so a step each.
   */
  type Field = 'dx' | 'dy' | 'rotate' | 'scaleX' | 'scaleY';
  let typing: Field | null = null;
  function set(field: Field, value: number): void {
    if (session && Number.isFinite(value)) {
      // Only a value that was filed began the step the next key replaces.
      if (editor.setTransform({ ...session, [field]: value }, typing === field)) {
        typing = field;
      }
    }
  }

  /**
   * On a small screen the window sits under the canvas, in the same column,
   * and the whole of it took the stage from the selection it transforms.
   * There the fingers do the work and the numbers wait folded; the studio's
   * step at opening decides (small-screen.ts, not a width query — a phone
   * lying down is wider than one), the reader's toggle after that.
   */
  function foldOnSmallScreen(details: HTMLDetailsElement): void {
    details.open = !details.closest('.studio.compact');
  }

  /** Scales are typed as percentages, the way the reference window shows them. */
  function percent(value: number): number {
    return Math.round(value * 1000) / 10;
  }

  /**
   * An emptied field wrote nothing and stayed empty while the selection kept
   * its number: left, it shows that number again. The field is the one whose
   * id matches, so the value is read from the same place the markup reads it.
   */
  function restore(e: Event): void {
    typing = null;
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'number' || Number.isFinite(input.valueAsNumber) || !session) {
      return;
    }
    const shown: Record<string, number> = {
      'tf-dx': Math.round(session.dx / FIXED_POINT_SCALE),
      'tf-dy': Math.round(session.dy / FIXED_POINT_SCALE),
      'tf-rotate': Math.round(session.rotate),
      'tf-scale-x': percent(session.scaleX),
      'tf-scale-y': percent(session.scaleY),
    };
    if (input.id in shown) {
      input.value = String(shown[input.id]);
    }
  }

  /**
   * Apply, cancel or Esc pressed inside the window unmounts the control that
   * had the focus, and it fell to <body>: the next Tab began at the top of
   * the page. It goes to the key of the tool in hand instead — the lasso,
   * which is where the selection was opened from.
   */
  function keepFocus(node: HTMLElement): () => void {
    let inside = false;
    const enter = () => (inside = true);
    // Only a move to somewhere else counts: a removal leaves the node detached.
    const leave = (e: FocusEvent) => {
      if (node.isConnected && !node.contains(e.relatedTarget as Node | null)) inside = false;
    };
    node.addEventListener('focusin', enter);
    node.addEventListener('focusout', leave);
    return () => {
      node.removeEventListener('focusin', enter);
      node.removeEventListener('focusout', leave);
      if (!inside) return;
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!active || active === document.body) {
          document.querySelector<HTMLElement>(`[data-tool="${CSS.escape(editor.tool)}"]`)?.focus();
        }
      });
    };
  }
</script>

{#if session}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="transform-menu"
    role="group"
    aria-label={t('transform.title')}
    use:draggable
    {@attach keepFocus}
    onkeydown={(e) => {
      // Escape inside the fields still cancels (WCAG 2.1.2: no keyboard trap).
      if (e.key === 'Escape') {
        e.stopPropagation();
        editor.cancelTransform();
      }
    }}
  >
    <p class="title" data-drag-handle>{t('transform.title')}</p>
    <!-- Label and field are siblings in the grid rather than a wrapping
         <label display:contents>, which older browsers drop out of the
         accessibility tree along with the association it carries. -->
    <details class="numbers" {@attach foldOnSmallScreen}>
    <summary>{t('transform.numbers')}<Icon name="chevron-down" size={16} /></summary>
    <div class="fields" onchange={restore} onfocusout={() => (typing = null)}>
      <label for="tf-dx">X</label>
      <input id="tf-dx" type="number" step="1" value={Math.round(session.dx / FIXED_POINT_SCALE)} oninput={(e) => set('dx', e.currentTarget.valueAsNumber * FIXED_POINT_SCALE)} />
      <label for="tf-dy">Y</label>
      <input id="tf-dy" type="number" step="1" value={Math.round(session.dy / FIXED_POINT_SCALE)} oninput={(e) => set('dy', e.currentTarget.valueAsNumber * FIXED_POINT_SCALE)} />
      <label for="tf-rotate">{t('transform.rotate')}</label>
      <input id="tf-rotate" type="number" step="1" value={Math.round(session.rotate)} oninput={(e) => set('rotate', e.currentTarget.valueAsNumber)} />
      <label for="tf-scale-x">{t('transform.scale_x')}</label>
      <input id="tf-scale-x" type="number" step="10" value={percent(session.scaleX)} oninput={(e) => set('scaleX', scaleFromField(e.currentTarget.valueAsNumber))} />
      <label for="tf-scale-y">{t('transform.scale_y')}</label>
      <input id="tf-scale-y" type="number" step="10" value={percent(session.scaleY)} oninput={(e) => set('scaleY', scaleFromField(e.currentTarget.valueAsNumber))} />
    </div>
    </details>

    <div class="row">
      <button class="key icon" onclick={() => editor.mirrorTransform('horizontal')} aria-keyshortcuts={editor.settings.letterKeys ? 'H' : undefined} aria-label={editor.keyHint(t('transform.flip_h'))} title={editor.keyHint(t('transform.flip_h'))}><Icon name="flip-h" /></button>
      <button class="key icon" onclick={() => editor.mirrorTransform('vertical')} aria-keyshortcuts={editor.settings.letterKeys ? 'Shift+H' : undefined} aria-label={editor.keyHint(t('transform.flip_v'))} title={editor.keyHint(t('transform.flip_v'))}><Icon name="flip-v" /></button>
      <button class="key icon step" onclick={() => editor.undoTransform()} aria-disabled={!editor.canUndoTransform} aria-keyshortcuts={editor.settings.letterKeys ? 'Z Control+Z' : 'Control+Z'} aria-label={editor.keyHint(t('transform.undo'))} title={editor.keyHint(t('transform.undo'))}><Icon name="undo" /></button>
      <button class="key icon step" onclick={() => editor.redoTransform()} aria-disabled={!editor.canRedoTransform} aria-keyshortcuts={editor.settings.letterKeys ? 'Y Control+Shift+Z' : 'Control+Shift+Z'} aria-label={editor.keyHint(t('transform.redo'))} title={editor.keyHint(t('transform.redo'))}><Icon name="redo" /></button>
    </div>

    <!-- On a phone the zoom window gives this one its row; its keys come along. -->
    <div class="row zoom" role="group" aria-label={t('scale.group')}>
      <button class="key icon" aria-disabled={editor.view.zoom <= ZOOM_MIN} onclick={() => editor.view.zoom <= ZOOM_MIN || editor.zoomBy(zoomDelta(editor.view.zoom, -1))} aria-label={t('scale.out')} title={t('scale.out')}><Icon name="minus" /></button>
      <button class="key" onclick={() => editor.resetView()} aria-label={t('scale.value', { percent: formatPercent(editor.view.zoom) })} title={t('scale.reset')}>{formatPercent(editor.view.zoom)}</button>
      <button class="key icon" aria-disabled={editor.view.zoom >= ZOOM_MAX} onclick={() => editor.view.zoom >= ZOOM_MAX || editor.zoomBy(zoomDelta(editor.view.zoom, 1))} aria-label={t('scale.in')} title={t('scale.in')}><Icon name="plus" /></button>
    </div>

    <label class="check">
      <input
        type="checkbox"
        checked={editor.transformWidthWithScale}
        onchange={(e) => editor.setTransformWidthWithScale(e.currentTarget.checked)}
      />
      {t('transform.width_with_scale')}
    </label>

    <div class="row">
      <button class="key primary" onclick={() => editor.commitTransform()} aria-label={t('transform.apply_label')}>{t('transform.apply')}</button>
      <button class="key" onclick={() => editor.cancelTransform()} aria-label={t('transform.cancel_label')}>{t('transform.cancel')}</button>
    </div>
  </div>
{/if}

<style>
  .title {
    margin: 0;
    cursor: move;
    font-weight: 600;
    /* One long word: on the same phone it was cut at «Трансформ». */
    overflow-wrap: anywhere;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .transform-menu {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    border: none;
    border-radius: var(--r-md);
    background: var(--canvas);
    font-size: 0.8125rem;
    /* For the fields, which stack where the window is narrow. */
    container: transform / inline-size;
  }
  /* A row of the window's own height, like its keys: it is pressed too. */
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--key-h, 2.75rem);
    list-style: none;
    cursor: pointer;
  }
  /* Flex already took the marker away; the chevron says it folds instead. */
  summary::-webkit-details-marker {
    display: none;
  }
  .numbers[open] summary :global(svg) {
    transform: rotate(180deg);
  }
  .numbers[open] summary {
    margin-bottom: 0.3rem;
  }
  /* Label beside its field, not above it: the window is 13rem, and stacked
     labels wrapped "Масштаб X" onto two lines. */
  .fields {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0.3rem 0.5rem;
  }
  .fields label {
    white-space: nowrap;
  }
  /* A phone at 200 % text gives the window 168 px and «Масштаб X, %» alone
     is 174: the field beside it was a 14 px sliver past the window's edge.
     There the label goes over its field, and may wrap. */
  @container transform (width < 10rem) {
    .fields {
      grid-template-columns: minmax(0, 1fr);
    }
    .fields label {
      white-space: normal;
    }
  }
  input[type='number'] {
    width: 100%;
    min-width: 0;
    min-height: var(--key-h, 2.75rem);
    padding: 0 6px;
    /* The boundary of a control, not a divider: white field on a white plate
       drawn with the hairline is 1.36:1, where 1.4.11 asks three. */
    border: 1px solid var(--edge);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: inherit;
    font: inherit;
  }
  .row {
    display: flex;
    gap: 0.35rem;
  }
  .row .key {
    flex: 1;
    /* The product's floor, not the standard's. 2.5.8 asks 24 and this asked 24;
       DESIGN §5 asks 44 of everything outside the montage grid, and a floating
       transform window is outside it. A standard is a floor under a floor. */
    min-height: var(--key-h, 2.75rem);
  }
  /* Four 88 px keys at 200 % text do not fit a phone's 168 px window:
     unwrapped, the window scrolled sideways. (The desktop's 13rem squeezes
     its four into one row, as before.) */
  @container transform (width < 10rem) {
    .row {
      flex-wrap: wrap;
    }
    /* «Применить» is 99 px there and the key's own padding left it 85. */
    .row .key {
      padding-inline: 0.3rem;
    }
    /* «трансформации» in the label is wider than the line beside the box. */
    .check {
      overflow-wrap: anywhere;
    }
  }
  .zoom {
    display: none;
  }
  /* Where the zoom window gives up its row (Editor.svelte, the compact step). */
  :global(:where(.studio.compact)) .row.zoom {
    display: flex;
  }
  /* At the limit a key stays in focus and says so (as in ScaleMenu): a
     disabled one under the finger that pressed it dropped the focus to body. */
  .zoom .key[aria-disabled='true'] {
    opacity: 0.4;
    cursor: default;
  }
  /* The same for the session's step keys: at the first or the last step
     they keep the focus (a step with none left does nothing by itself). */
  .row .step[aria-disabled='true'] {
    opacity: 0.4;
    cursor: default;
  }
  /* The whole label is the target, a key tall: the box alone is 13 px. */
  .check {
    display: flex;
    align-items: center;
    min-height: var(--key-h, 2.75rem);
    gap: 0.4rem;
    line-height: 1.25;
  }
</style>
