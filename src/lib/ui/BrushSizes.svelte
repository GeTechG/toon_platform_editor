<script lang="ts">
  /**
   * The plain thickness widget: the reference's row of growing dots, for
   * whoever wants a key instead of the slider box (BrushPanel).
   */
  import type { EditorState } from './editor-state.svelte';
  import { BRUSH_SIZES_LOGICAL } from '../format/constants';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();
</script>

<div class="sizes" role="group" aria-label={t('brush.sizes_group')}>
  {#each BRUSH_SIZES_LOGICAL as size (size)}
    <button
      class="size-btn"
      class:active={editor.brushSizeLogical === size}
      aria-pressed={editor.brushSizeLogical === size}
      onclick={() => (editor.brushSizeLogical = size)}
      title={t('brush.size_title', { size })}
      aria-label={t('brush.size_value', { count: size })}
    >
      <!-- Capped at 22, 21 and 43 were the same dot; 30 still sits inside the
           44 key and keeps all five apart. -->
      <span class="dot" style:width="{Math.min(size + 2, 30)}px" style:height="{Math.min(size + 2, 30)}px"></span>
    </button>
  {/each}
  <span
    class="size"
    class:picked={(BRUSH_SIZES_LOGICAL as readonly number[]).includes(editor.brushSizeLogical)}
    title={t('brush.size_hint')}
    role="status"
  ><span aria-hidden="true">{editor.brushSizeLogical}px</span><span class="sr-only">{t('brush.size_value', { count: editor.brushSizeLogical })}</span></span>
</div>

<style>
  .sizes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }
  /* Size dots read as one control group — quiet until picked, red ring
     when active, echoing the reference's row of growing dots. */
  .size-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--key-h);
    height: var(--key-h);
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: transparent;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .size-btn:hover {
    background: var(--sub);
  }
  /* Five black dots differing only in diameter are not a selection state —
     the picked one inverts to a filled red key with a white dot. */
  .size-btn.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  .size-btn.active .dot {
    background: var(--canvas);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .size-btn:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .dot {
    background: var(--ink);
    border-radius: 50%;
  }
  /* The dot is the content, and forced colors paint a background as Canvas.
     The picked key opts out (controls.css) and keeps its white dot. */
  @media (forced-colors: active) {
    .dot {
      background: CanvasText;
    }
  }
  .size {
    min-width: 2.75rem;
    font-size: 0.74rem;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  /* «px» on screen, pixels in words to a reader (as the slider says them). */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* Phone: the readout only repeats what the picked dot already says — and
     stays when a size between the dots picks none. */
  @media (max-width: 40rem) {
    .sizes {
      gap: 0.15rem;
    }
    .size.picked {
      display: none;
    }
  }
</style>
