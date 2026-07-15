<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { exportGif } from '../export/export-gif';

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
      exportError = 'GIF export failed, please try again';
    } finally {
      exporting = false;
    }
  }
</script>

<button onclick={downloadGif} disabled={exporting} title="Download GIF">
  {exporting ? `${exportProgress}%` : 'GIF'}
</button>
{#if exportError}
  <span class="error" role="alert">{exportError}</span>
{/if}

<style>
  button {
    min-width: 2.2rem;
    min-height: 2.2rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
  button:disabled {
    cursor: progress;
    color: #666;
  }
  .error {
    font-size: 0.85rem;
    color: #c00;
  }
</style>
