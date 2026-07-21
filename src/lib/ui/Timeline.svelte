<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import FrameThumb from './FrameThumb.svelte';
  import Icon from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  let strip: HTMLDivElement;
  let scrollLeft = $state(0);
  let scrollWidth = $state(0);
  let clientWidth = $state(0);

  // Native overflow-x already scrolls (wheel/trackpad/touch); the arrows are
  // for mouse users on desktop, so they only light up when there's overflow.
  const canLeft = $derived(scrollLeft > 1);
  const canRight = $derived(scrollLeft < scrollWidth - clientWidth - 1);

  function sync(): void {
    if (!strip) return;
    scrollLeft = strip.scrollLeft;
    scrollWidth = strip.scrollWidth;
    clientWidth = strip.clientWidth;
  }

  function nudge(dir: 1 | -1): void {
    strip.scrollBy({ left: dir * clientWidth * 0.8, behavior: 'smooth' });
  }

  // Recompute reachability whenever the frame count or the strip width changes.
  $effect(() => {
    void editor.doc.frames.length;
    void clientWidth;
    sync();
  });
</script>

<div class="scroller">
  <button
    class="key icon arrow"
    disabled={!canLeft}
    onclick={() => nudge(-1)}
    aria-label="Scroll frames left"
    title="Scroll frames left"
  >
    <Icon name="chevron-left" size={18} />
  </button>

  <div class="frames" bind:this={strip} bind:clientWidth onscroll={sync}>
    {#each editor.doc.frames as frame, i (frame)}
      <button
        class="frame"
        class:active={i === editor.displayedFrame}
        disabled={editor.playing}
        onclick={() => editor.selectFrame(i)}
        title="Frame {i + 1}"
      >
        <FrameThumb {frame} tools={editor.doc.tools} docWidth={editor.doc.width} docHeight={editor.doc.height} />
        <span class="num">{i + 1}</span>
      </button>
    {/each}
  </div>

  <button
    class="key icon arrow"
    disabled={!canRight}
    onclick={() => nudge(1)}
    aria-label="Scroll frames right"
    title="Scroll frames right"
  >
    <Icon name="chevron-right" size={18} />
  </button>
</div>

<style>
  .scroller {
    display: flex;
    align-items: stretch;
    gap: 0.3rem;
    min-width: 0;
  }
  .arrow {
    flex: none;
    height: auto;
  }
  .frames {
    display: flex;
    gap: 2px;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: thin;
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    padding: 3px;
  }
  .frame {
    position: relative;
    flex: none;
    padding: 0;
    border: 1px solid var(--hairline);
    border-radius: 5px;
    overflow: hidden;
    background: var(--canvas);
    cursor: pointer;
  }
  .frame.active {
    border-color: var(--electric);
    box-shadow: inset 0 0 0 1px var(--electric);
  }
  .num {
    position: absolute;
    top: 1px;
    right: 2px;
    font-size: 0.6rem;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--electric);
  }
  .frame:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
