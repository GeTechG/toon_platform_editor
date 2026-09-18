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
    aria-label="Трансформация"
    onkeydown={(e) => {
      // Escape inside the fields still cancels (WCAG 2.1.2: no keyboard trap).
      if (e.key === 'Escape') {
        e.stopPropagation();
        editor.cancelTransform();
      }
    }}
  >
    <div class="fields">
      <label>X<input type="number" step="1" value={Math.round(session.dx)} oninput={(e) => set('dx', e.currentTarget.value)} /></label>
      <label>Y<input type="number" step="1" value={Math.round(session.dy)} oninput={(e) => set('dy', e.currentTarget.value)} /></label>
      <label>Поворот<input type="number" step="1" value={Math.round(session.rotate)} oninput={(e) => set('rotate', e.currentTarget.value)} /></label>
      <label>Масштаб X<input type="number" step="10" value={percent(session.scaleX)} oninput={(e) => set('scaleX', String(Number(e.currentTarget.value) / 100))} /></label>
      <label>Масштаб Y<input type="number" step="10" value={percent(session.scaleY)} oninput={(e) => set('scaleY', String(Number(e.currentTarget.value) / 100))} /></label>
    </div>

    <div class="row">
      <button class="key" onclick={() => editor.mirrorTransform('horizontal')} aria-label="Отразить по горизонтали (H)" title="Отразить по горизонтали (H)">⇋</button>
      <button class="key" onclick={() => editor.mirrorTransform('vertical')} aria-label="Отразить по вертикали (Shift+H)" title="Отразить по вертикали (Shift+H)">⇅</button>
      <button class="key icon" onclick={() => editor.undoTransform()} disabled={!editor.canUndoTransform} aria-label="Шаг назад" title="Шаг назад"><Icon name="undo" /></button>
      <button class="key icon" onclick={() => editor.redoTransform()} disabled={!editor.canRedoTransform} aria-label="Шаг вперёд" title="Шаг вперёд"><Icon name="redo" /></button>
    </div>

    <label class="check">
      <input
        type="checkbox"
        checked={editor.transformWidthWithScale}
        onchange={(e) => editor.setTransformWidthWithScale(e.currentTarget.checked)}
      />
      Менять толщину с масштабом
    </label>

    <div class="row">
      <button class="key primary" onclick={() => editor.commitTransform()} aria-label="Применить (Enter)">Применить</button>
      <button class="key" onclick={() => editor.cancelTransform()} aria-label="Отменить (Esc)">Отменить</button>
    </div>
  </div>
{/if}

<style>
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
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  input[type='number'] {
    width: 100%;
    min-height: 32px;
    padding: 0 6px;
    border: 1px solid var(--hairline, #0b0c1024);
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
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }
</style>
