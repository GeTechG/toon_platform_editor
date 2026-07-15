<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import FrameThumb from './FrameThumb.svelte';

  let { editor }: { editor: EditorState } = $props();
</script>

<div class="timeline">
  <div class="actions">
    <button disabled={editor.playing} onclick={() => editor.addFrameAfterActive()} title="Add frame after current">
      ✚
    </button>
    <button disabled={editor.playing} onclick={() => editor.removeActiveFrame()} title="Delete current frame">
      ✖
    </button>
  </div>
  <div class="frames">
    {#each editor.doc.frames as frame, i (frame)}
      <button
        class="frame"
        class:active={i === editor.displayedFrame}
        disabled={editor.playing}
        onclick={() => editor.selectFrame(i)}
        title="Frame {i + 1}"
      >
        <FrameThumb {frame} docWidth={editor.doc.width} docHeight={editor.doc.height} />
        <span class="num">{i + 1}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .timeline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .actions {
    display: flex;
    gap: 0.25rem;
  }
  .actions button {
    min-width: 2rem;
    min-height: 2rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
  .frames {
    display: flex;
    flex: 1;
    gap: 0;
    overflow-x: auto;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 2px;
  }
  .frame {
    position: relative;
    flex: none;
    padding: 0;
    border: 1px solid #ddd;
    background: #fff;
    cursor: pointer;
  }
  .frame.active {
    border-color: #1a6ee0;
    box-shadow: inset 0 0 0 1px #1a6ee0;
  }
  .num {
    position: absolute;
    top: 0;
    right: 1px;
    font-size: 0.6rem;
    line-height: 1;
    color: #1a6ee0;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
