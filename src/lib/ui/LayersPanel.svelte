<script lang="ts">
  // Floating layers panel: the dialog chrome around the shared layer list
  // (LayerRows), which the studio timeline renders inline instead.
  import type { EditorState } from './editor-state.svelte';
  import LayerRows from './LayerRows.svelte';
  import Icon from './Icon.svelte';

  let { editor, onClose }: { editor: EditorState; onClose: () => void } = $props();
</script>

<div class="layers-plate" role="dialog" aria-label="Слои">
  <header>
    <h2>Слои</h2>
    <button class="key icon" onclick={onClose} aria-label="Закрыть слои">
      <Icon name="x" />
    </button>
  </header>

  <LayerRows {editor} />
</div>

<style>
  .layers-plate {
    position: absolute;
    left: 0;
    bottom: calc(100% + 0.4rem);
    z-index: 6;
    display: flex;
    flex-direction: column;
    width: min(16rem, calc(100vw - 2rem));
    max-height: 22rem;
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    box-shadow: 0 12px 28px -12px rgba(15, 23, 60, 0.35);
  }
  /* Mobile: a bottom drawer instead of a floating plate. */
  @media (max-width: 40rem) {
    .layers-plate {
      position: fixed;
      inset: auto 0 0 0;
      width: auto;
      border-radius: var(--r-md) var(--r-md) 0 0;
      max-height: 60dvh;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.4rem 0.4rem 0.75rem;
    border-bottom: 1px solid var(--hairline);
  }
  header h2 {
    margin: 0;
    font-size: 0.95rem;
  }
</style>
