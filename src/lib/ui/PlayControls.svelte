<script lang="ts">
  import { untrack } from 'svelte';
  import { frameCount } from '../model/operations';
  import type { EditorState } from './editor-state.svelte';
  import { LoopPlayer } from '../player/player';
  import { playbackRange } from './frame-selection';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

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
      // The frames run on the player's clock in both modes, as the reference's
      // `UpdatePlayFrame` does. Tied, every time the animation comes back round
      // the track is pulled to where this frame sits in it — so a track shorter
      // than the animation repeats under it rather than falling silent, and a
      // longer one is heard only as far as the animation reaches.
      if (editor.audio.sync && editor.audio.hasTrack && editor.playbackFrame < lastFrame) {
        editor.audio.reseekAtLoop(editor.playbackFrame, editor.doc.frame_rate);
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
    // The reference defers an autosave until the preview is over; this is the
    // moment it is over, so a deferred write happens now rather than on the
    // next turn of the clock.
    editor.onStop?.();
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
  title={editor.playing ? t('play.title_stop') : t('play.title_play')}
  aria-label={editor.playing ? t('play.stop') : t('play.play')}
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
