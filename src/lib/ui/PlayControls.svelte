<script lang="ts">
  import { untrack } from 'svelte';
  import { frameCount } from '../model/operations';
  import type { EditorState } from './editor-state.svelte';
  import { LoopPlayer } from '../player/player';
  import { frameForTime } from '../audio/track';
  import { playbackStartFrame } from './frame-selection';
  import Icon from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  let player: LoopPlayer | null = null;
  let rafId = 0;
  // The frame being edited when playback started — where stop returns to,
  // whether the loop began there or (Multator) from the first frame.
  let resumeFrame = 0;

  function tick(now: number): void {
    // Whatever goes wrong inside one frame, the next one still gets scheduled.
    // A throw here used to end the loop for good: the frames froze, the button
    // still said "stop", and only a page reload brought playback back.
    try {
      player?.tick(now);
      // With a track the sound is the clock: the frame is read off the audio
      // element's own time rather than counted alongside it, so the two cannot
      // drift apart however long the loop runs. Once the track ends the frame
      // counter carries on by itself.
      if (editor.audio.sounding) {
        editor.playbackFrame =
          frameForTime(editor.audio.currentTime, editor.doc.frame_rate) % frameCount(editor.doc);
      }
    } catch (err) {
      console.warn('playback tick failed:', err);
    }
    rafId = requestAnimationFrame(tick);
  }

  function play(): void {
    // `editor.playing` outlives this component — a remount during playback
    // leaves the flag set with no loop behind it. Trust the loop, not the flag.
    if (editor.playing && player !== null) {
      return;
    }
    cancelAnimationFrame(rafId);
    resumeFrame = editor.activeFrame;
    const startFrame = playbackStartFrame(editor.activeFrame, editor.ux.playFromStart);
    player = new LoopPlayer({
      frameCount: frameCount(editor.doc),
      fps: editor.doc.frame_rate,
      startFrame,
      onFrame: (frame) => (editor.playbackFrame = frame),
    });
    editor.playbackFrame = startFrame;
    editor.audio.playFrom(startFrame, editor.doc.frame_rate);
    editor.playing = true;
    rafId = requestAnimationFrame(tick);
  }

  function stop(): void {
    cancelAnimationFrame(rafId);
    editor.audio.stop();
    if (player) {
      player.stop();
      editor.activeFrame = resumeFrame;
      player = null;
    }
    editor.playing = false;
  }

  /** Play/stop from the outside too — the reference binds Space to it. */
  export function toggle(): void {
    // Same reason as in `play`: a set flag with no loop behind it is a stopped
    // preview, and pressing the key has to start it rather than stop nothing.
    if (editor.playing && player !== null) {
      stop();
    } else {
      play();
    }
  }

  // Decoding a long track takes a second or two, and the draft list hands one
  // over on the way in — so the preview can be running before the sound is
  // ready. When it lands, it joins the frames that are already playing rather
  // than staying silent until the next press.
  $effect(() => {
    if (!editor.audio.hasTrack || !editor.playing) {
      return;
    }
    if (untrack(() => editor.audio.sounding)) {
      return;
    }
    editor.audio.playFrom(untrack(() => editor.playbackFrame), editor.doc.frame_rate);
  });

  $effect(() => () => cancelAnimationFrame(rafId));
</script>

<button
  class="key play"
  class:playing={editor.playing}
  onclick={toggle}
  data-key="Space"
  title={editor.playing ? 'Остановить просмотр (Space)' : 'Проиграть кадры (Space)'}
  aria-label={editor.playing ? 'Остановить' : 'Проиграть'}
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
