<script lang="ts">
  import type { EditorState, Tool } from './editor-state.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  // `key` is the shortcut the button shows in place of its icon on hover
  // (reference `.control p`); it is spelled out in the title as well.
  const TOOLS: Record<Tool, { icon: IconName; title: string; label: string; key: string }> = {
    pencil: { icon: 'pencil', title: 'Карандаш (B)', label: 'Карандаш', key: 'B' },
    eraser: { icon: 'eraser', title: 'Ластик (E)', label: 'Ластик', key: 'E' },
    feather: { icon: 'feather', title: 'Перо (F) — обводка и заливка', label: 'Перо', key: 'F' },
    pixel: { icon: 'pixel', title: 'Пиксель — рисует по сетке', label: 'Пиксель', key: '' },
    'mega-eraser': {
      icon: 'mega-eraser',
      title: 'Мега-ластик (Alt+E) — режет линии целиком',
      label: 'Мега-ластик',
      key: 'Alt+E',
    },
    pipette: { icon: 'pipette', title: 'Пипетка (P) — ещё раз: взять цвет с экрана', label: 'Пипетка', key: 'P' },
    drag: { icon: 'hand', title: 'Рука (D) — двигать холст', label: 'Рука', key: 'D' },
    lasso: { icon: 'lasso', title: 'Лассо (Q) — взять кадр и трансформировать', label: 'Лассо', key: 'Q' },
    distort: { icon: 'distort', title: 'Искажение (~) — дребезг штрихов кадра', label: 'Искажение', key: '~' },
  };

  // The preset owns the toolset; the pipette additionally only exists once the
  // palette is enabled (reference ToolPanel.hx).
  const tools = $derived(
    editor.ux.tools
      .filter((id) => id !== 'pipette' || !editor.ux.pipetteNeedsPalette || editor.paletteExpanded)
      .map((id) => ({ id, ...TOOLS[id] })),
  );

  /**
   * Clicking the already-active pipette opens the browser's own EyeDropper,
   * which picks from anywhere on screen (reference Picker.Selected). Without
   * that API the button just stays the canvas pipette.
   */
  function selectTool(id: Tool): void {
    const eyeDropper = (window as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (id === 'pipette' && editor.tool === 'pipette' && eyeDropper) {
      new eyeDropper().open().then(
        (result) => editor.setBrushColor(result.sRGBHex),
        () => {},
      );
      return;
    }
    editor.selectTool(id);
  }
</script>

{#if editor.features.tools}
  <div class="tools" role="group" aria-label="Инструменты">
    {#each tools as t (t.id)}
      <!-- `draw` marks the one tool that *is* the "draw" action, so the
           Signal Rule's single red lands on it and nowhere else. -->
      <button
        class="key icon"
        class:active={editor.tool === t.id}
        class:draw={t.id === 'pencil'}
        aria-pressed={editor.tool === t.id}
        onclick={() => selectTool(t.id)}
        data-key={t.key}
        title={t.title}
        aria-label={t.label}
      >
        <Icon name={t.icon} />
      </button>
    {/each}
  </div>
{/if}

{#if editor.tool === 'pipette'}
  <div class="pick-source" role="group" aria-label="Источник пипетки">
    {#each [['canvas', 'Холст'], ['layer', 'Слой']] as [source, label] (source)}
      <button
        class="key"
        class:active={editor.pickSource === source}
        aria-pressed={editor.pickSource === source}
        onclick={() => editor.setPickSource(source as 'canvas' | 'layer')}
        title={source === 'canvas'
          ? 'Брать цвет с видимого холста (Alt — только активный слой)'
          : 'Брать цвет только с активного слоя'}
      >{label}</button>
    {/each}
  </div>
{/if}

<style>
  .tools {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .pick-source {
    display: flex;
    gap: 4px;
  }
  .pick-source .key {
    padding: 0 10px;
    font-size: 13px;
  }
  /* Studio (toonio.ru): the reference `.left .tools` is a two-column grid of
     44px controls down the side of the canvas. */
  :global(.editor.studio) .tools,
  :global(.editor.studio) .pick-source {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  :global(.editor.studio) .pick-source {
    margin-top: 0.5rem;
  }
  :global(.editor.studio) .pick-source .key {
    padding: 0 4px;
    font-size: 12px;
  }
  @media (max-width: 40rem) {
    .tools,
    :global(.editor.studio) .tools,
    :global(.editor.studio) .pick-source {
      display: flex;
      flex-wrap: wrap;
      gap: 0.15rem;
      margin: 0;
    }
  }
</style>
