<script lang="ts">
  import type { EditorState } from './editor-state.svelte';

  let { editor }: { editor: EditorState } = $props();
</script>

<div class="timeline">
  <div class="frames">
    {#each editor.doc.frames as frame, i (frame)}
      <button
        class="frame"
        class:active={i === editor.displayedFrame}
        disabled={editor.playing}
        onclick={() => editor.selectFrame(i)}
      >
        {i + 1}
      </button>
    {/each}
  </div>
  <div class="actions">
    <button disabled={editor.playing} onclick={() => editor.addFrameAfterActive()} title="Add frame after current">
      + frame
    </button>
    <button disabled={editor.playing} onclick={() => editor.removeActiveFrame()} title="Delete current frame">
      − frame
    </button>
  </div>
</div>

<style>
  .timeline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .frames {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    max-width: 100%;
  }
  button {
    min-width: 2rem;
    min-height: 2rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .frame.active {
    background: #1a6ee0;
    color: #fff;
    border-color: #1a6ee0;
  }
</style>
