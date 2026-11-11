<script lang="ts">
  /**
   * The box of the tool in hand: the bucket's, the magnet's, or the brush's
   * for a tool that draws. One choice, for the tool's own key and for the
   * phone's settings key under the canvas.
   */
  import type { EditorState } from './editor-state.svelte';
  import BrushPanel from './BrushPanel.svelte';
  import FillPanel from './FillPanel.svelte';
  import MagnetPanel from './MagnetPanel.svelte';

  let { editor, tool }: { editor: EditorState; tool: string } = $props();
</script>

{#if tool === 'bucket'}
  <FillPanel {editor} />
{:else if tool === 'magnet'}
  <MagnetPanel {editor} />
{:else}
  <BrushPanel {editor} />
{/if}
