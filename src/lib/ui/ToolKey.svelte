<script lang="ts">
  /**
   * One tool key. Every tool is an item of its own (panels.ts), so the rail is
   * however many of these the config put in a panel — not a fixed group.
   */
  import type { EditorState } from './editor-state.svelte';
  import { toolKeyList, toolSpec } from './panels';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

  let { editor, tool }: { editor: EditorState; tool: string } = $props();

  // The register is no state: an updated plugin's icon and label are heard
  // through `pluginsVersion`, or the key kept the old ones until a reload.
  const spec = $derived((void editor.pluginsVersion, toolSpec(tool)));
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
  // A second press opens the browser's own eyedropper — only where there is
  // one and the setting lets it (owner, sixteenth audit): Safari and Firefox
  // have none, and the title promised it there.
  const title = $derived(
    tool === 'pipette' && 'EyeDropper' in globalThis && editor.settings.chromePicker
      ? t('tool.pipette.title_screen')
      : spec?.title ?? '',
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
    title={editor.keyHint(title)}
    aria-label={spec.label}
  >
    <Icon name={spec.icon} />
  </button>
{/if}
