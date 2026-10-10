<script lang="ts">
  // Read-only looping player: renders a document's frames on a canvas and loops
  // at the document's frame rate. Reuses the same frame renderer as the editor
  // (single rendering contract) and the drift-free LoopPlayer. No tools, no
  // onion skin, no draft — a pure viewer for the public share page.
  import { untrack } from 'svelte';
  import { CANVAS_LOGICAL_WIDTH, FIXED_POINT_SCALE } from '../format/constants';
  import type { ToonDocument } from '../format/types';
  import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
  import { renderDensity, sheetRaster } from '../ui/viewport';
  import { FrameCache } from './frame-cache';
  import { LoopPlayer } from './player';
  import { playLength, replayAt, replayEnded, replayStart } from './replay';
  import { frameForTime, playRefusal, trackKeepsTime, trackShouldRestart, trackTimeFor, unlockElement } from '../audio/track';
  // Only the player's own words: `../i18n` registers the studio's whole
  // catalogue, and the share page downloaded all of it for three strings. A
  // named import of the JSON leaves the rest out of the bundle.
  import { play } from '../i18n/ru.json';
  import { BASE_LOCALE, i18n, translator } from '../i18n-core';
  // The accent is an alias (`--accent` → `--signal-dark`), which a literal
  // fallback cannot carry: the player brings the table itself, as the studio does.
  import '../ui/tokens.css';

  i18n.addResourceBundle(BASE_LOCALE, 'editor', { play }, true, false);
  const t = translator('editor');

  /**
   * Reduced motion means no autoplay: the visitor lands on the first frame
   * and presses play. That is the alternative DESIGN requires for a looping
   * animation, so it has to be decided before the clock ever starts.
   */
  function prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  let {
    doc,
    /** Renders the play/pause key over the canvas. */
    controls = true,
    playing = $bindable(!prefersReducedMotion()),
    audioSrc,
    audioSync = true,
    current = $bindable(0),
  }: {
    /** Any published version — the share page serves documents as they were saved. */
    doc: ToonDocument;
    controls?: boolean;
    playing?: boolean;
    /** The publication's soundtrack, if it has one. */
    audioSrc?: string;
    /**
     * Whether the frames are tied to that track. Tied, the track is the clock
     * and the loop returns to the first frame with it; untied, the animation
     * keeps its own clock and the track plays underneath.
     */
    audioSync?: boolean;
    /**
     * The frame on screen. Bindable so a host can show it and step through it
     * while paused — which is the only way to check a frame against the track.
     */
    current?: number;
  } = $props();

  // The server stores v7 only (no migrations), so the document is drawn as is.
  const view = $derived(doc);
  // A one-frame drawing is replayed stroke by stroke: then the "frames" below
  // are its strokes and the rate is the replay's own.
  const length = $derived(playLength(view));
  const total = $derived(length.frames);
  const fps = $derived(length.fps);

  const renderer = new Canvas2DFrameRenderer();
  let canvasEl: HTMLCanvasElement;
  let wrapWidth = $state(CANVAS_LOGICAL_WIDTH);
  let wrapHeight = $state(0);

  // Fit the document aspect inside the wrap: capped by width and, when known,
  // by height (same letterboxing as the editor canvas).
  const cssWidth = $derived(
    Math.max(
      1,
      Math.min(
        wrapWidth || CANVAS_LOGICAL_WIDTH,
        wrapHeight > 0 ? wrapHeight * (view.width / view.height) : Infinity,
      ),
    ),
  );
  const cssHeight = $derived(cssWidth * (view.height / view.width));

  /** The frames rasterized ahead of the clock (`warm` below), as pixels. */
  const cache = new FrameCache<ImageData>();
  /**
   * Whether the film is rasterized — every frame of it. Until
   * then the clock stands and the viewer is shown the wait: a film that
   * starts at once stutters through its first lap, drawing each frame live.
   */
  let ready = $state(false);
  let warmed = $state(0);
  const percent = new Intl.NumberFormat(BASE_LOCALE, { style: 'percent' });

  /**
   * The bitmap the frames are rasterized into — the sheet's, by the rule the
   * studio's canvas draws by (`sheetRaster`): a sheet up to 1080p in its own
   * pixels, a larger one in a whole fraction of them. The canvas is that
   * bitmap and the page stretches it, so the film is the same pixels for
   * everyone who watches it, and the ones it was drawn in.
   */
  const raster = $derived.by(() => {
    // Capped like the editor's canvas: 3× on a phone is not visible on line
    // art and costs 2.25× the pixels of a sheet too large to be drawn whole.
    // The page is rendered on the server first, where there is no screen.
    const dpr = renderDensity(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    const pxWidth = cssWidth * dpr;
    return {
      ...sheetRaster(
        view,
        { x: 0, y: 0, scale: (pxWidth * FIXED_POINT_SCALE) / view.width },
        { width: pxWidth, height: cssHeight * dpr },
      ),
      screen: pxWidth,
    };
  });

  const bitmapWidth = $derived(raster.width);
  const bitmapHeight = $derived(raster.height);

  /** One frame of the show — a frame of the film or a step of the replay. */
  function paint(index: number, ctx: Canvas2DLike): void {
    const viewport = { scale: raster.level / FIXED_POINT_SCALE, dpr: 1 };
    if (length.replay) {
      renderer.render(replayAt(view, index), 0, ctx, viewport);
    } else {
      renderer.render(view, index, ctx, viewport);
    }
  }

  function draw(): void {
    if (!canvasEl) {
      return;
    }
    const { width: pxWidth, height: pxHeight } = raster;
    if (canvasEl.width !== pxWidth) {
      canvasEl.width = pxWidth;
    }
    if (canvasEl.height !== pxHeight) {
      canvasEl.height = pxHeight;
    }
    if (current >= total) {
      return;
    }
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike | null;
    // Safari hands out null once the page's canvas memory is spent: a frame
    // not drawn, not an effect that throws.
    if (!ctx) {
      return;
    }
    // A frame rasterized already is laid down as it is; one the warming has
    // not reached yet is drawn stroke by stroke, as every frame used to be.
    cache.fit(view, pxWidth, pxHeight);
    const ready = cache.get(current);
    if (ready) {
      (ctx as unknown as CanvasRenderingContext2D).putImageData(ready, 0, 0);
      return;
    }
    paint(current, ctx);
  }

  // The film is rasterized ahead of its clock, a frame a task from the one on
  // screen onwards, so the show is not every stroke of every layer drawn again
  // on every lap. Pixels read back, not canvases: Safari caps canvas memory,
  // and a film's worth of them ran into it.
  $effect(() => {
    void view;
    // The bitmap's size and not the raster: that one changes with every pixel
    // of a resized window, and a sheet drawn whole is the same bitmap through it.
    void bitmapWidth;
    void bitmapHeight;
    ready = false;
    warmed = 0;
    const scratch = document.createElement('canvas');
    let timer: ReturnType<typeof setTimeout>;
    const warm = (): void => {
      const { width: pxWidth, height: pxHeight } = raster;
      cache.fit(view, pxWidth, pxHeight);
      const index = cache.next(total, Math.min(untrack(() => current), total - 1));
      if (index === null) {
        ready = true;
        return;
      }
      if (scratch.width !== pxWidth) scratch.width = pxWidth;
      if (scratch.height !== pxHeight) scratch.height = pxHeight;
      // Made for reading back: every frame drawn on it is read once and kept.
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        // No canvas to rasterize on (Safari out of canvas memory): the film
        // plays drawn live rather than waits for frames that will not come.
        ready = true;
        return;
      }
      paint(index, ctx as unknown as Canvas2DLike);
      try {
        cache.put(index, ctx.getImageData(0, 0, pxWidth, pxHeight));
      } catch {
        // The device has no room for another frame: the film plays with what
        // is held and draws the rest live, rather than loading for ever.
        ready = true;
        return;
      }
      warmed = cache.progress(total);
      timer = setTimeout(warm, 0);
    };
    timer = setTimeout(warm, 0);
    return () => {
      clearTimeout(timer);
      scratch.width = 0;
      scratch.height = 0;
      cache.clear();
    };
  });

  // The soundtrack, when there is one. It is built once per src and its own
  // clock drives the frames while it sounds, so picture and sound cannot drift
  // apart however long the loop runs.
  let audio = $state<HTMLAudioElement | null>(null);
  $effect(() => {
    if (!audioSrc) {
      audio = null;
      return;
    }
    const element = new Audio(audioSrc);
    // Only its length up front: a track with the picture never autoplays, and
    // most visits never press play. Play and a paused step fetch the rest.
    element.preload = 'metadata';
    audio = element;
    return () => {
      // Paused is not let go: a track that was playing keeps downloading.
      element.pause();
      element.removeAttribute('src');
      element.load();
      audio = null;
    };
  });

  // The frame clock runs only while playing. Pausing tears the loop down;
  // pressing play builds a new one starting at the frame on the canvas, so
  // nothing jumps. `current` is read untracked — the loop writes it.
  $effect(() => {
    if (!playing || !ready) {
      // Pressed while the film is still loading: the press is the only one
      // there will be, and iOS lets the track sound later only if it was
      // unlocked inside it.
      if (playing && audio) {
        unlockElement(audio);
      }
      return;
    }
    // A replayed drawing is played once and rests finished: play on the
    // finished drawing starts it over, and the last stroke stops the clock.
    const once = length.replay;
    if (once) {
      current = replayStart(untrack(() => current), total);
    }
    const player = new LoopPlayer({
      frameCount: total,
      fps,
      startFrame: Math.min(untrack(() => current), total - 1),
      onFrame: (index) => {
        if (once && replayEnded(current, index, total)) {
          current = total - 1;
          playing = false;
          return;
        }
        current = index;
      },
    });
    const sound = audio;
    let lastFrame = untrack(() => current);
    if (sound) {
      // Tied, the animation owns the loop point, so the track must not wrap on
      // its own; untied it loops freely underneath.
      sound.loop = !audioSync;
      // Untied, the track just plays under the picture, from its own start.
      // Tied past its end, it is quiet until the animation comes round (the
      // lap below): set there, `play()` rewound the ended track to 0, and the
      // frames, read off its clock, jumped back to the first.
      const at = audioSync
        ? trackTimeFor(untrack(() => current) % total, fps, sound.duration)
        : sound.currentTime;
      if (at !== null) {
        sound.currentTime = at;
        void sound.play().catch((err) => {
          // Every browser refuses to start sound the visitor did not ask for.
          // Playing the picture silently would look like a mute animation and
          // leave no way to discover the sound, so the whole thing stops here
          // and the play key comes back — one press then starts both together.
          // A file the browser will not play (ogg on Safari 16) is no refusal
          // of a press: the picture plays on without it.
          if (playRefusal(err) === 'blocked') playing = false;
        });
      } else {
        // Quiet for now, but iOS lets the element sound only after a play()
        // inside a press — without it the lap below came round silent.
        unlockElement(sound);
      }
    }
    let raf = requestAnimationFrame(function tick(now: number) {
      player.tick(now);
      if (audioSync && sound) {
        if (trackKeepsTime(sound)) {
          // Tied, the track is pinned to the first frame and comes back round
          // with the animation instead of running on past it.
          if (trackShouldRestart(sound.currentTime, total, fps)) {
            sound.currentTime = 0;
          }
          current = frameForTime(sound.currentTime, fps) % total;
        } else if (current < lastFrame) {
          // A track shorter than the animation starts again with it.
          sound.currentTime = 0;
          void sound.play().catch(() => {});
        }
        lastFrame = current;
      }
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      sound?.pause();
    };
  });

  // Stepping a frame while paused takes the track with it, so frame N can be
  // heard where it actually falls. Silently: a step is not playback.
  $effect(() => {
    const frame = current;
    if (playing || !audioSync || !audio) {
      return;
    }
    untrack(() => {
      if (audio) {
        audio.currentTime = (frame % total) / fps;
      }
    });
  });

  // Another document in the same player (the site going from one share page to
  // the next) may be shorter than the frame on screen: the draw below would
  // skip it and leave the previous drawing up, counted «кадр 38 из 10».
  $effect.pre(() => {
    if (current >= total) {
      current = 0;
    }
  });

  // Redraw on frame change or resize (client-only; effects do not run in SSR).
  $effect(() => {
    void current;
    void cssWidth;
    void view;
    draw();
  });
</script>

<div class="wrap" bind:clientWidth={wrapWidth} bind:clientHeight={wrapHeight}>
  <!-- ARIA in HTML allows any role on <canvas>; without one the animation is
       an anonymous box in the accessibility tree. -->
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas
    bind:this={canvasEl}
    style:width="{cssWidth}px"
    style:height="{cssHeight}px"
    style:image-rendering={raster.screen >= raster.width * 2 ? 'pixelated' : null}
    role="img"
    aria-label={t('play.frame_alt', { current: current + 1, total })}
  ></canvas>
  {#if !ready}
    <div class="loading" role="status">{t('play.loading', { percent: percent.format(warmed) })}</div>
  {/if}
  {#if controls}
    <button
      class="play-key"
      type="button"
      onclick={() => (playing = !playing)}
      title={playing ? t('play.pause') : t('play.play')}
      aria-label={playing ? t('play.pause') : t('play.play')}
    >
      <!-- Two paths inline instead of the editor's Icon component: this entry
           point exists to keep the viewer's module graph small. -->
      <svg
        width="1.25rem"
        height="1.25rem"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d={playing ? 'M9 6v12M15 6v12' : 'M8 5.5v13l11-6.5-11-6.5Z'} />
      </svg>
      <span>{playing ? t('play.pause') : t('play.play')}</span>
    </button>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* The studio's primary key (DESIGN §5): a flat pill in the working red,
     pressed to 96 %. Electric keeps to the drawing aids since 2026-09-23. */
  .play-key {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-width: 44px;
    min-height: 44px;
    padding: 0 0.9rem;
    border: none;
    border-radius: var(--r-pill, 999px);
    background: var(--accent);
    color: var(--canvas, #ffffff);
    font: inherit;
    font-weight: 650;
    cursor: pointer;
    /* No fallbacks: the player brings the table of tokens itself (above). */
    transition:
      transform var(--dur-fast) var(--ease-out),
      background-color var(--dur) var(--ease-out);
  }
  @media (hover: hover) {
    .play-key:hover {
      background: var(--accent-ink);
    }
  }
  .play-key:active {
    transform: translateX(-50%) scale(0.96);
  }
  .play-key:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }
  /* The key keeps its colour and its pressed state; only the travel goes. */
  @media (prefers-reduced-motion: reduce) {
    .play-key {
      transition: none;
    }
    .play-key:active {
      transform: translateX(-50%);
    }
  }
  /* Set apart by tone, not by a shadow: a plate of the table's own colour. */
  .loading {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 0.5rem 0.9rem;
    border-radius: var(--r-pill);
    background: var(--sub);
    color: var(--ink);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  canvas {
    display: block;
    background: var(--canvas);
    max-width: 100%;
    max-height: 100%;
  }
</style>
