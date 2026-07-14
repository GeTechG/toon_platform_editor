<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { PLAYER_FPS_MAX, PLAYER_FPS_MIN } from '../format/constants';
  import { LoopPlayer } from '../player/player';

  let { editor }: { editor: EditorState } = $props();

  let player: LoopPlayer | null = null;
  let rafId = 0;

  function tick(now: number): void {
    player?.tick(now);
    rafId = requestAnimationFrame(tick);
  }

  function play(): void {
    if (editor.playing) {
      return;
    }
    player = new LoopPlayer({
      frameCount: editor.doc.frames.length,
      fps: editor.doc.frame_rate,
      startFrame: editor.activeFrame,
      onFrame: (frame) => (editor.playbackFrame = frame),
    });
    editor.playbackFrame = editor.activeFrame;
    editor.playing = true;
    rafId = requestAnimationFrame(tick);
  }

  function stop(): void {
    cancelAnimationFrame(rafId);
    if (player) {
      editor.activeFrame = player.stop();
      player = null;
    }
    editor.playing = false;
  }

  function toggle(): void {
    if (editor.playing) {
      stop();
    } else {
      play();
    }
  }

  function onFpsChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    editor.setFps(Number(input.value));
    input.value = String(editor.doc.frame_rate);
  }

  $effect(() => () => cancelAnimationFrame(rafId));
</script>

<div class="controls">
  <button class="play" onclick={toggle}>
    {editor.playing ? '■ Stop' : '▶ Play'}
  </button>
  <label>
    fps
    <input
      type="number"
      min={PLAYER_FPS_MIN}
      max={PLAYER_FPS_MAX}
      value={editor.doc.frame_rate}
      onchange={onFpsChange}
      disabled={editor.playing}
    />
  </label>
</div>

<style>
  .controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .play {
    min-height: 2rem;
    padding: 0 0.75rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    cursor: pointer;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: #666;
  }
  input {
    width: 3.5rem;
    min-height: 1.8rem;
  }
</style>
