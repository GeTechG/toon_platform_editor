<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { LoopPlayer } from '../player/player';
  import Icon from './Icon.svelte';

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

  $effect(() => () => cancelAnimationFrame(rafId));
</script>

<button
  class="key play"
  class:playing={editor.playing}
  onclick={toggle}
  title={editor.playing ? 'Stop preview' : 'Play preview'}
  aria-label={editor.playing ? 'Stop preview' : 'Play preview'}
>
  <Icon name={editor.playing ? 'stop' : 'play'} size={22} />
</button>

<style>
  /* Play leads the transport row like the reference ▶: wider than an icon
     key, and flips to a filled electric key while previewing. */
  .play {
    min-width: 3.4rem;
  }
  .play.playing {
    background: var(--electric);
    border-color: transparent;
    color: var(--canvas);
  }
  .play.playing:hover {
    background: var(--electric);
    border-color: transparent;
  }
</style>
