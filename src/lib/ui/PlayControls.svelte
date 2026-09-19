<script lang="ts">
  import { untrack } from 'svelte';
  import { frameCount } from '../model/operations';
  import type { EditorState } from './editor-state.svelte';
  import { LoopPlayer } from '../player/player';
  import { frameForTime } from '../audio/track';
  import { playbackRange } from './frame-selection';
  import Icon from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  let player: LoopPlayer | null = null;
  let rafId = 0;
  // The frame being edited when playback started — where stop returns to,
  // whether the loop began there or (Multator) from the first frame.
  let resumeFrame = 0;
  /** Previous frame on screen — a drop means the animation came back round. */
  let lastFrame = 0;

  function tick(now: number): void {
    // Whatever goes wrong inside one frame, the next one still gets scheduled.
    // A throw here used to end the loop for good: the frames froze, the button
    // still said "stop", and only a page reload brought playback back.
    try {
      player?.tick(now);
      // Tied, the track is pinned to the first frame: it restarts with the
      // animation, and in between the frame is read off the track's own clock
      // rather than counted alongside it, so the two cannot drift. Untied, the
      // frame counter is left alone and the track simply plays underneath.
      if (editor.audio.sync && editor.audio.hasTrack) {
        const frames = frameCount(editor.doc);
        if (editor.audio.sounding) {
          editor.audio.restartIfLooped(frames, editor.doc.frame_rate);
          editor.playbackFrame =
            frameForTime(editor.audio.currentTime, editor.doc.frame_rate) % frames;
        } else if (editor.playbackFrame < lastFrame) {
          // The track ran out before the animation did — it starts again with
          // it, and the stretch in between stays quiet.
          editor.audio.playFrom(0, editor.doc.frame_rate);
        }
      }
      lastFrame = editor.playbackFrame;
    } catch (err) {
      console.warn('playback tick failed:', err);
    }
    rafId = requestAnimationFrame(tick);
  }

  /**
   * What Space plays right now: under Toonio a frame selection is the range,
   * and a one-frame document plays nothing at all.
   */
  const range = $derived(
    playbackRange(editor.activeFrame, editor.selection, frameCount(editor.doc), editor.ux, false),
  );
  const canPlay = $derived(editor.playing || range !== null);

  function play(fromActive = false): void {
    // `editor.playing` outlives this component — a remount during playback
    // leaves the flag set with no loop behind it. Trust the loop, not the flag.
    if (editor.playing && player !== null) {
      return;
    }
    const span = playbackRange(
      editor.activeFrame,
      editor.selection,
      frameCount(editor.doc),
      editor.ux,
      fromActive,
    );
    if (!span) {
      return;
    }
    cancelAnimationFrame(rafId);
    resumeFrame = editor.activeFrame;
    const startFrame = span.first;
    player = new LoopPlayer({
      frameCount: frameCount(editor.doc),
      fps: editor.doc.frame_rate,
      startFrame,
      loopStart: span.start,
      loopEnd: span.end,
      onFrame: (frame) => (editor.playbackFrame = frame),
    });
    editor.playbackFrame = startFrame;
    lastFrame = startFrame;
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

  /**
   * Play/stop from the outside too — the reference binds Space to it, and
   * Shift+Space starts at the active frame inside the same range.
   */
  export function toggle(options: { fromActive?: boolean } = {}): void {
    // Same reason as in `play`: a set flag with no loop behind it is a stopped
    // preview, and pressing the key has to start it rather than stop nothing.
    if (editor.playing && player !== null) {
      stop();
    } else {
      play(options.fromActive === true);
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
  disabled={!canPlay}
  onclick={() => toggle()}
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
