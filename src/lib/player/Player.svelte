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
  import { canWarmApart, warmApart, warmCrew, type Crew } from './warm';
  import { aheadReady, firstUnready, playbackWindow, startNeed, windowFrames } from '../render/playback-window';
  import { frameTwins } from './twins';
  import { LoopPlayer } from './player';
  import { playLength, replayAt, replayEnded, replayStart } from './replay';
  import { filmTiming } from '../model/timing';
  import { stills } from '../model/stills';
  import { frameForTime, playRefusal, trackKeepsTime, trackShouldRestart, trackTimeFor, unlockElement } from '../audio/track';
  // Only the player's own words: `../i18n` registers the studio's whole
  // catalogue, and the share page downloaded all of it for three strings. A
  // named import of the JSON leaves the rest out of the bundle.
  import { play } from '../i18n/ru.json';
  import { play as playEn } from '../i18n/en.json';
  import { BASE_LOCALE, dateLocale, i18n, translator } from '../i18n-core';
  // The accent is an alias (`--accent` → `--signal-dark`), which a literal
  // fallback cannot carry: the player brings the table itself, as the studio does.
  import '../ui/tokens.css';

  i18n.addResourceBundle(BASE_LOCALE, 'editor', { play }, true, false);
  i18n.addResourceBundle('en', 'editor', { play: playEn }, true, false);
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
    volume = 1,
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
    /** How loud the track sounds, 0…1; zero is silence. */
    volume?: number;
    /**
     * The frame on screen. Bindable so a host can show it and step through it
     * while paused — which is the only way to check a frame against the track.
     */
    current?: number;
  } = $props();

  // The film as stills: ticks on which every layer shows the same drawings are
  // one frame that lasts them, as a pause was before continuations (v8).
  const still = $derived(stills(doc));
  const view = $derived(still.film);
  // A one-frame drawing is replayed stroke by stroke: then the "frames" below
  // are its strokes and the rate is the replay's own.
  const length = $derived(playLength(view));
  const total = $derived(length.frames);
  const fps = $derived(length.fps);
  // Time is ticks: a held frame stays on screen its ticks, and the track
  // goes by them. A replay's strokes are a tick each.
  const holds = $derived(length.replay ? undefined : still.holds);
  const timing = $derived(filmTiming(holds, total));

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
   * Whether the clock may run: the frames ahead of the one on screen are
   * ready — the whole film when it fits the window (`playback-window.ts`), else
   * as many as keep the first lap ahead of the drawing. Until then the clock
   * stands and the viewer is shown the wait: a film that starts at once
   * stutters through its first lap, drawing each frame live.
   */
  let ready = $state(false);
  /** Whether the film has been on screen: a wait after it is over the last frame, not a blank. */
  let shown = $state(false);
  /** Played drawn live, never waited for: a replay, or no room or canvas for frames. */
  let live = $state(false);
  /** How much of the wait is over, 0…1. */
  let warmed = $state(0);
  /** Tells the warming the show moved on; set by it. */
  let wake = (): void => {};
  const percent = new Intl.NumberFormat(dateLocale(), { style: 'percent' });

  /**
   * The bitmap the frames are rasterized into — the sheet's, by the rule the
   * studio's canvas draws by (`sheetRaster`). The canvas is that bitmap and
   * the page stretches it, so the film is the same pixels for everyone who
   * watches it, and the ones it was drawn in.
   */
  const raster = $derived(sheetRaster(view));
  /**
   * How many frames of the sheet this device holds ready. A film tied to its
   * track is held whole, as before the window: the track is its clock, and a
   * track cannot wait for a frame as the frame clock does — two clocks gated
   * by turns took a late track for a lap gone by.
   */
  const windowSize = $derived(audioSrc && audioSync
    ? Infinity
    : playbackWindow(
      typeof navigator === 'undefined' ? undefined : (navigator as { deviceMemory?: number }).deviceMemory,
      raster.width,
      raster.height,
    ));
  /**
   * Whether the page shows the bitmap at twice its size or more: then its
   * pixels are shown as they are. The density capped like the editor's; the
   * page is rendered on the server first, where there is no screen.
   */
  const magnified = $derived(
    cssWidth * renderDensity(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1) >= raster.width * 2,
  );
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
    // Until the film is first ready the canvas stays blank under the wait:
    // the viewer is shown the loading and then the film, not a frame drawn
    // live in the meantime (the owner, 2026-10-22).
    if (current >= total || !shown) {
      return;
    }
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike | null;
    // Safari hands out null once the page's canvas memory is spent: a frame
    // not drawn, not an effect that throws.
    if (!ctx) {
      return;
    }
    // A frame rasterized already is laid down as it is. One the warming has
    // not reached yet is drawn stroke by stroke where the film plays live or
    // a paused viewer steps to it; playing, the clock waits for it over the
    // last frame instead.
    cache.fit(view, pxWidth, pxHeight);
    const held = cache.get(current);
    if (held) {
      (ctx as unknown as CanvasRenderingContext2D).putImageData(held, 0, 0);
      return;
    }
    if (live || !playing) paint(current, ctx);
  }

  // The film is rasterized ahead of its clock, so the show is not every stroke
  // of every layer drawn again on every lap: by a crew of workers where the
  // browser has them (`warm.ts`), and here, a frame a task from the one on
  // screen onwards, where it has not or for what they left undone. Pixels read
  // back, not canvases: Safari caps canvas memory, and a film's worth of them
  // ran into it.
  $effect(() => {
    void view;
    void bitmapWidth;
    void bitmapHeight;
    // A drawing replayed stroke by stroke has a step per stroke: rasterized
    // ahead, five hundred strokes were five hundred whole sheets held and each
    // of them every stroke before it drawn again. It is drawn live, a step a
    // tenth of a second.
    if (length.replay) {
      live = true;
      ready = true;
      shown = true;
      return;
    }
    live = false;
    shown = false;
    ready = false;
    warmed = 0;
    // The window is part of the warming: a track tied or untied on the same
    // film starts it over, whole or windowed.
    const size = windowSize;
    // Frames shown a second, the held ones counted by their ticks.
    const playRate = (fps * total) / timing.total;
    // A frame held by copying it is rasterized once, and its copies are
    // given the same pixels.
    const twins = frameTwins(view);
    const asked = new Set<number>();
    const arrivals: number[] = [];
    const has = (index: number): boolean => cache.get(index) !== undefined;
    const measured = (): number | undefined => arrivals.length < 2
      ? undefined
      : ((arrivals.length - 1) * 1000) / Math.max(1, arrivals[arrivals.length - 1] - arrivals[0]);
    /** Whether the clock may run: enough frames ready in a row from the one on screen. */
    const settle = (): void => {
      if (live) return;
      const ahead = aheadReady(has, total, untrack(() => current) % total);
      const need = startNeed({ total, window: size, playRate, rasterRate: measured() });
      warmed = Math.min(1, ahead / need);
      if (!ready && ahead >= need) {
        ready = true;
        shown = true;
      }
    };
    /** The frame to rasterize next: one of the window not held or asked for yet. */
    const pick = (): number | null => {
      for (const index of windowFrames(total, untrack(() => current) % total, size)) {
        const twin = twins[index] ?? index;
        if (has(index) || asked.has(twin)) continue;
        asked.add(twin);
        return twin;
      }
      return null;
    };
    const hold = (index: number, frame: ImageData): void => {
      asked.delete(index);
      arrivals.push(performance.now());
      if (arrivals.length > 8) arrivals.shift();
      for (const [copy, twin] of twins.entries()) {
        if (twin === index) cache.put(copy, frame);
      }
      settle();
    };
    /** No room or no canvas for frames: the film plays drawn live rather than waits. */
    const goLive = (): void => {
      live = true;
      ready = true;
      shown = true;
    };
    const scratch = document.createElement('canvas');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let crew: Crew | null = null;
    // On the page the drawing shares the thread with the clock: a frame of a
    // heavy film drawn while the film plays held the clock up and it skipped
    // frames. Without a crew the page fills the window while the clock
    // stands, plays it, and fills it again.
    const clockRuns = (): boolean => playing && ready;
    const warm = (): void => {
      timer = undefined;
      if (clockRuns()) return;
      const { width: pxWidth, height: pxHeight } = raster;
      cache.fit(view, pxWidth, pxHeight);
      const next = pick();
      // Nothing wanted now: the show moving on wakes it (`wake` below).
      if (next === null) return;
      if (scratch.width !== pxWidth) scratch.width = pxWidth;
      if (scratch.height !== pxHeight) scratch.height = pxHeight;
      // Made for reading back: every frame drawn on it is read once and kept.
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        // No canvas to rasterize on (Safari out of canvas memory): the film
        // plays drawn live rather than waits for frames that will not come.
        goLive();
        return;
      }
      paint(next, ctx as unknown as Canvas2DLike);
      try {
        hold(next, ctx.getImageData(0, 0, pxWidth, pxHeight));
      } catch {
        // The device has no room for another frame: the film plays with what
        // is held and draws the rest live, rather than loading for ever.
        goLive();
        return;
      }
      timer = setTimeout(warm, 0);
    };
    const onPage = (): void => {
      crew = null;
      // What a fallen crew had been asked for is the page's to draw.
      asked.clear();
      timer ??= setTimeout(warm, 0);
    };
    wake = () => {
      if (crew) crew.kick();
      // Everything wanted may be held already: then nothing arrives to say so.
      settle();
      if (!crew && !live && !clockRuns()) timer ??= setTimeout(warm, 0);
    };
    let gone = false;
    try {
      if (!canWarmApart()) {
        throw new Error('no workers here');
      }
      cache.fit(view, raster.width, raster.height);
      const own = twins.filter((twin, index) => twin === index).length;
      crew = warmApart(
        view,
        warmCrew(navigator.hardwareConcurrency, Math.min(own, size)),
        pick,
        (index, frame) => {
          // A frame of the film this effect has let go of is nobody's.
          if (gone) return;
          hold(index, frame);
        },
        onPage,
      );
    } catch {
      onPage();
    }
    return () => {
      gone = true;
      wake = () => {};
      crew?.stop();
      clearTimeout(timer);
      scratch.width = 0;
      scratch.height = 0;
      cache.clear();
    };
  });

  // The show moves on: the frames behind it leave a film longer than the
  // window, the crew is told what is wanted now, and a frame not ready in
  // time stops the clock until enough are again — the film is not shown
  // with frames skipped or drawn live a stroke at a time (owner, 2026-11-16).
  $effect(() => {
    const frame = current;
    // A pause is time the page may draw in, too.
    void playing;
    if (length.replay || live || frame >= total) return;
    untrack(() => {
      if (total > windowSize) cache.trim(windowFrames(total, frame, windowSize));
      wake();
    });
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

  // As loud as the host says. Zero is said both ways: iOS does not let a page
  // set an element's volume, only mute it.
  $effect(() => {
    if (audio) {
      audio.volume = volume;
      audio.muted = volume === 0;
    }
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
    /**
     * The clock moves the show to `index`. A late tick, the track's clock or
     * a tab put away can step over several frames, a whole lap even: the
     * first of them not ready is where the show stops and waits, not the one
     * it landed on — no frame is skipped.
     */
    const advance = (index: number, laps: number): void => {
      // Stopped already: nothing moves the show until it starts again.
      if (!ready) return;
      const from = current;
      const stop = live ? null : firstUnready((frame) => cache.get(frame) !== undefined, total, from, index, laps);
      if (stop === null) {
        current = index;
        return;
      }
      ready = false;
      current = stop;
      // Stopped where it was: nothing changed for the warming to hear.
      wake();
    };
    const player = new LoopPlayer({
      frameCount: total,
      fps,
      startFrame: Math.min(untrack(() => current), total - 1),
      holds,
      onFrame: (index, _lapped, laps) => {
        if (once && replayEnded(current, index, total)) {
          current = total - 1;
          playing = false;
          return;
        }
        advance(index, laps);
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
        ? trackTimeFor(timing.start(untrack(() => current) % total), fps, sound.duration)
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
      // The clock stopped on a frame not ready: the track must not move it on.
      if (!ready) return;
      if (audioSync && sound) {
        if (trackKeepsTime(sound)) {
          // Tied, the track is pinned to the first frame and comes back round
          // with the animation instead of running on past it.
          if (trackShouldRestart(sound.currentTime, timing.total, fps)) {
            sound.currentTime = 0;
          }
          current = timing.frameAt(frameForTime(sound.currentTime, fps) % timing.total);
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
        audio.currentTime = timing.start(frame % total) / fps;
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
    void ready;
    void shown;
    void playing;
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
    style:image-rendering={magnified ? 'pixelated' : null}
    style:visibility={shown ? null : 'hidden'}
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
