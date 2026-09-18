<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { exportGif } from '../export/export-gif';
  import Icon from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  let exporting = $state(false);
  let exportProgress = $state(0);
  let exportError = $state('');

  async function downloadGif(): Promise<void> {
    if (exporting) {
      return;
    }
    exporting = true;
    exportProgress = 0;
    exportError = '';
    try {
      const bytes = await exportGif(editor.doc, (done, total) => {
        exportProgress = Math.round((done / total) * 100);
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'animation.gif';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      console.warn('GIF export failed:', err);
      exportError = 'GIF не собрался — попробуй ещё раз';
    } finally {
      exporting = false;
    }
  }

  /** Reference Alt+S: start the export without reaching for the button. */
  export function start(): void {
    void downloadGif();
  }
</script>

<button
  class="key"
  onclick={downloadGif}
  disabled={exporting}
  data-key="Alt+S"
  title="Экспорт в GIF (Alt+S)"
  aria-label="Экспорт в GIF"
>
  {#if exporting}
    <span class="progress">{exportProgress}%</span>
  {:else}
    <Icon name="download" />
  {/if}
</button>
{#if exportError}
  <span class="error" role="alert">{exportError}</span>
{/if}

<style>
  .key:disabled {
    cursor: progress;
    opacity: 1;
    color: var(--ink-2);
  }
  .progress {
    padding: 0 0.35rem;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  /* DESIGN's Signal Rule reserves red for the "draw" action — errors stay ink. */
  .error {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ink);
  }
</style>
