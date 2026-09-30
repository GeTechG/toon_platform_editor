<script lang="ts">
  /**
   * One tool key. Every tool is an item of its own (panels.ts), so the rail is
   * however many of these the config put in a panel — not a fixed group.
   */
  import type { EditorState } from './editor-state.svelte';
  import { toolKeyList, toolSpec } from './panels';
  import Icon from './Icon.svelte';

  let { editor, tool }: { editor: EditorState; tool: string } = $props();

  const spec = $derived(toolSpec(tool));
  // Both keys where a tool has two (the hand D or O, the lasso Q or S), each
  // left out when single-letter keys are off.
  const keys = $derived(toolKeyList(tool).map((key) => editor.keyHint(key)).filter(Boolean));
  // A key is drawn wherever the arrangement puts it — the preset only decided
  // where it started. The pipette is the one exception the references make of
  // themselves: it exists only once the palette is enabled (ToolPanel.hx), and
  // under Toonio it is not a rail button at all — the palette's foot holds it
  // (reference `E:205-208`).
  const offered = $derived(
    tool !== 'pipette'
      || (!editor.ux.pipetteOffRail
        && (!editor.ux.pipetteNeedsPalette || editor.paletteExpanded)),
  );
</script>

{#if offered && spec}
  <button
    class="key icon"
    class:active={editor.tool === tool}
    aria-pressed={editor.tool === tool}
    onclick={() => editor.selectTool(tool)}
    data-key={keys.join(' / ') || undefined}
    data-tool={tool}
    aria-keyshortcuts={keys.join(' ') || undefined}
    title={editor.keyHint(spec.title)}
    aria-label={spec.label}
  >
    <Icon name={spec.icon} />
  </button>
{/if}
