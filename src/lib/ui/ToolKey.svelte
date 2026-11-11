<script lang="ts">
  /**
   * One tool key. Every tool is an item of its own (panels.ts), so the rail is
   * however many of these the config put in a panel — not a fixed group.
   */
  import type { EditorState } from './editor-state.svelte';
  import { toolSpec } from './panels';
  import { chordLabel, toolCommand } from './keymap';
  import Icon from './Icon.svelte';
  import ToolBox from './ToolBox.svelte';
  import PopKey from './PopKey.svelte';
  import { t } from '../i18n';

  let {
    editor,
    tool,
    brush = false,
  }: {
    editor: EditorState;
    tool: string;
    /** Pressed while in hand, the key opens the brush box under itself (panels.ts `toolOpensBrush`). */
    brush?: boolean;
  } = $props();

  // The register is no state: an updated plugin's icon and label are heard
  // through `pluginsVersion`, or the key kept the old ones until a reload.
  const spec = $derived((void editor.pluginsVersion, toolSpec(tool)));
  // Both keys where a tool has two (the hand D or O, the lasso Q or S), each
  // left out when single-letter keys are off.
  const command = $derived(toolCommand(tool));
  const keys = $derived(editor.keysOf(command).map(chordLabel));
  // A key is drawn wherever the arrangement puts it — the preset only decided
  // where it started. The pipette is the one exception the references make of
  // themselves: it exists only once the palette is enabled (ToolPanel.hx), and
  // under Toonio it is not a rail button at all — the palette's foot holds it
  // (reference `E:205-208`).
  const offered = $derived(tool !== 'pipette' || editor.pipetteOffered);
  // A second press opens the browser's own eyedropper — only where there is
  // one and the setting lets it (owner, sixteenth audit): Safari and Firefox
  // have none, and the title promised it there.
  const title = $derived(
    tool === 'pipette' && 'EyeDropper' in globalThis && editor.settings.browserPipette
      ? t('tool.pipette.title_screen')
      : spec?.title ?? '',
  );
</script>

{#if offered && spec && brush}
  <PopKey
    label={spec.label}
    title={t(tool === 'bucket' ? 'tool.again_fill' : tool === 'magnet' ? 'tool.again_magnet' : 'tool.again_brush', { title: editor.keyHint(title, command) })}
    active={editor.tool === tool}
    gate={() => {
      if (editor.tool === tool) return true;
      editor.selectTool(tool);
      return false;
    }}
    attrs={{
      'aria-pressed': editor.tool === tool,
      'data-key': keys.join(' / ') || undefined,
      'data-tool': tool,
      'aria-keyshortcuts': editor.keyAria(command),
    }}
  >
    {#snippet face()}<Icon name={spec.icon} />{/snippet}
    <!-- The bucket and the magnet draw no line: their keys open their own boxes. -->
    <ToolBox {editor} {tool} />
  </PopKey>
{:else if offered && spec}
  <button
    class="key icon"
    class:active={editor.tool === tool}
    aria-pressed={editor.tool === tool}
    onclick={() => editor.selectTool(tool)}
    data-key={keys.join(' / ') || undefined}
    data-tool={tool}
    aria-keyshortcuts={editor.keyAria(command)}
    title={editor.keyHint(title, command)}
    aria-label={spec.label}
  >
    <Icon name={spec.icon} />
  </button>
{/if}
