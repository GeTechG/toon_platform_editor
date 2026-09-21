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
      aria-label={t('brush.size_label', { size })}
    >
      <span class="dot" style:width="{Math.min(size + 2, 22)}px" style:height="{Math.min(size + 2, 22)}px"></span>
    </button>
  {/each}
  <span class="size" title={t('brush.size_hint')}>{editor.brushSizeLogical}px</span>
</div>

<style>
  .sizes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }
  /* Size dots read as one control group — quiet until picked, electric ring
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
    background: var(--sky);
  }
  /* Five black dots differing only in diameter are not a selection state —
     the picked one inverts to a filled electric key with a white dot. */
  .size-btn.active {
    background: var(--electric);
    border-color: var(--electric);
  }
  .size-btn.active .dot {
    background: var(--canvas);
    box-shadow: 0 0 0 1px var(--electric);
  }
  .size-btn:focus-visible {
    outline: 3px solid var(--electric);
    outline-offset: 2px;
  }
  .dot {
    background: var(--ink);
    border-radius: 50%;
  }
  .size {
    min-width: 2.75rem;
    font-size: 0.74rem;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    .size-btn {
      transition: background 0.15s ease, border-color 0.15s ease;
    }
  }
  /* Phone: the readout only repeats what the picked dot already says. */
  @media (max-width: 40rem) {
    .sizes {
      gap: 0.15rem;
    }
    .size {
      display: none;
    }
  }
</style>
