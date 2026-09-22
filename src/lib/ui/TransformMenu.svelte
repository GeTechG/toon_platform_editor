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
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  const session = $derived(editor.transform?.session);

  /** A field edit is an absolute value, not a step — it replaces that one axis. */
  function set(field: 'dx' | 'dy' | 'rotate' | 'scaleX' | 'scaleY', raw: string): void {
    const value = Number(raw);
    if (session && Number.isFinite(value)) {
      editor.setTransform({ ...session, [field]: value });
    }
  }

  /** Scales are typed as percentages, the way the reference window shows them. */
  function percent(value: number): number {
    return Math.round(value * 1000) / 10;
  }
</script>

{#if session}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="transform-menu"
    role="group"
    aria-label={t('transform.title')}
    use:draggable
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
    <div class="fields">
      <label for="tf-dx">X</label>
      <input id="tf-dx" type="number" step="1" value={Math.round(session.dx)} oninput={(e) => set('dx', e.currentTarget.value)} />
      <label for="tf-dy">Y</label>
      <input id="tf-dy" type="number" step="1" value={Math.round(session.dy)} oninput={(e) => set('dy', e.currentTarget.value)} />
      <label for="tf-rotate">{t('transform.rotate')}</label>
      <input id="tf-rotate" type="number" step="1" value={Math.round(session.rotate)} oninput={(e) => set('rotate', e.currentTarget.value)} />
      <label for="tf-scale-x">{t('transform.scale_x')}</label>
      <input id="tf-scale-x" type="number" step="10" value={percent(session.scaleX)} oninput={(e) => set('scaleX', String(Number(e.currentTarget.value) / 100))} />
      <label for="tf-scale-y">{t('transform.scale_y')}</label>
      <input id="tf-scale-y" type="number" step="10" value={percent(session.scaleY)} oninput={(e) => set('scaleY', String(Number(e.currentTarget.value) / 100))} />
    </div>

    <div class="row">
      <button class="key icon" onclick={() => editor.mirrorTransform('horizontal')} aria-label={t('transform.flip_h')} title={t('transform.flip_h')}><Icon name="flip-h" /></button>
      <button class="key icon" onclick={() => editor.mirrorTransform('vertical')} aria-label={t('transform.flip_v')} title={t('transform.flip_v')}><Icon name="flip-v" /></button>
      <button class="key icon" onclick={() => editor.undoTransform()} disabled={!editor.canUndoTransform} aria-label={t('transform.undo')} title={t('transform.undo')}><Icon name="undo" /></button>
      <button class="key icon" onclick={() => editor.redoTransform()} disabled={!editor.canRedoTransform} aria-label={t('transform.redo')} title={t('transform.redo')}><Icon name="redo" /></button>
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
    touch-action: none;
    user-select: none;
  }
  .transform-menu {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    border: 1px solid var(--hairline, #0b0c1024);
    border-radius: 10px;
    background: var(--canvas, #fff);
    font-size: 13px;
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
  input[type='number'] {
    width: 100%;
    min-width: 0;
    min-height: 32px;
    padding: 0 6px;
    /* The boundary of a control, not a divider: white field on a white plate
       drawn with the hairline is 1.36:1, where 1.4.11 asks three. */
    border: 1px solid var(--edge, #0b0c107a);
    border-radius: 6px;
    background: var(--canvas, #fff);
    color: inherit;
    font: inherit;
  }
  .row {
    display: flex;
    gap: 0.35rem;
  }
  .row .key {
    flex: 1;
    /* WCAG 2.5.8: every control keeps a 24px target. */
    min-height: 32px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    line-height: 1.25;
  }
</style>
