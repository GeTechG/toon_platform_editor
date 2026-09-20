<script lang="ts">
  /**
   * One tool key. Every tool is an item of its own (panels.ts), so the rail is
   * however many of these the config put in a panel — not a fixed group.
   */
  import type { EditorState } from './editor-state.svelte';
  import type { SelectableTool } from './ux-profile';
  import { TOOL_KEYS } from './panels';
  import Icon from './Icon.svelte';

  let { editor, tool }: { editor: EditorState; tool: SelectableTool } = $props();

  const spec = $derived(TOOL_KEYS[tool]);
  // The preset owns the toolset; the pipette additionally only exists once the
  // palette is enabled (reference ToolPanel.hx), and under Toonio it is not a
  // rail button at all — the palette's foot holds it (reference `E:205-208`).
  const offered = $derived(
    editor.ux.tools.includes(tool)
      && (tool !== 'pipette'
        || (!editor.ux.pipetteOffRail
          && (!editor.ux.pipetteNeedsPalette || editor.paletteExpanded))),
  );
</script>

{#if offered}
  <button
    class="key icon"
    class:active={editor.tool === tool}
    aria-pressed={editor.tool === tool}
    onclick={() => editor.selectTool(tool)}
    data-key={spec.key}
    title={spec.title}
    aria-label={spec.label}
  >
    <Icon name={spec.icon} />
  </button>
{/if}
