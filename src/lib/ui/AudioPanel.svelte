<script lang="ts">
  // Floating soundtrack panel: everything about the track that is not the wave
  // itself. The wave stays on the timeline, where it lines up with the frames;
  // the file, its credits and the bin live here, off the strip, because a row
  // of fields under the frames was in the way of the frames.
  import { tick } from 'svelte';
  import type { EditorState } from './editor-state.svelte';
  import Icon from './Icon.svelte';
  import { AUDIO_MAX_CREDIT } from '../audio/track';
  import { t } from '../i18n';

  let {
    editor,
    anchor,
    onClose,
  }: { editor: EditorState; anchor?: HTMLElement; onClose: () => void } = $props();

  /** The switch's name and its hint are two things: ids to point at each. */
  const uid = $props.id();

  let picker = $state<HTMLInputElement | undefined>();
  let plate = $state<HTMLDivElement | undefined>();
  let replaceKey = $state<HTMLButtonElement | undefined>();
  /** What the last pick came to, for a screen reader: the fields appearing say it to the eye. */
  let loadedNote = $state('');
  let at = $state<{ x: number; top?: number; bottom?: number; max: number } | undefined>();

  /** Bumped by a window resize: the key moves with the layout, the plate follows. */
  let resized = $state(0);

  /**
   * Over its key, right edges flush — under it when the key sits too near the
   * top. Fixed and placed rather than absolute in the key's wrapper: the bar
   * that holds the key scrolls, and a scroll box cut the plate off whole. On
   * a phone the plate is a drawer along the bottom and places itself.
   */
  $effect(() => {
    void resized;
    // A track lays the wave's lane under the strip, which lifts the key.
    void editor.audio.hasTrack;
    if (!anchor || !plate) return;
    // The drawer places itself; a left kept from the desktop would pin it
    // to one side of a narrowed window.
    if (matchMedia('(max-width: 40rem)').matches) {
      at = undefined;
      return;
    }
    const key = anchor.getBoundingClientRect();
    const box = plate.getBoundingClientRect();
    const x = Math.max(8, Math.min(key.right - box.width, window.innerWidth - box.width - 8));
    // Held by the edge that faces the key, so a track's fields grow the plate
    // away from it rather than over it. Too tall for either side (large text),
    // it takes the roomier one and scrolls inside it.
    const above = key.top - 6 - 8;
    const below = window.innerHeight - key.bottom - 6 - 8;
    at = box.height <= above || above >= below
      ? { x, bottom: window.innerHeight - key.top + 6, max: above }
      : { x, top: key.bottom + 6, max: below };
  });

  async function pickTrack(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // picking the same file twice must fire change again
    if (!file) {
      return;
    }
    loadedNote = '';
    if (await editor.audio.load(file, file.name.replace(/\.[^.]+$/, ''), editor.audio.author)) {
      loadedNote = t('audio.loaded', { name: editor.audio.name, length: clock(editor.audio.duration) });
      // «Выбрать файл…» leaves with the empty plate and takes the focus with
      // it; the key that does the same job in the full plate takes it over.
      await tick();
      if (document.activeElement === document.body) {
        replaceKey?.focus();
      }
    }
  }

  /** The × and the bin go with the plate: focus goes back to the key, not to <body>. */
  function close(): void {
    anchor?.focus();
    onClose();
  }

  function removeTrack(): void {
    if (!editor.warnings || confirm(t('audio.remove_confirm'))) {
      editor.audio.clear();
      close();
    }
  }

  /** `м:сс` — the only shape a length under an hour needs. */
  function clock(seconds: number): string {
    const whole = Math.max(0, Math.round(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  const filmSeconds = $derived(editor.doc.layers[0].frames.length / editor.doc.frame_rate);
  // One bar per frame means the strip only ever shows the part of the track the
  // animation is long enough to reach. Naming both lengths is what keeps a
  // short wave from reading as a broken one.
  const trackOutruns = $derived(editor.audio.duration - filmSeconds > 1);
</script>

<svelte:window onresize={() => resized++} />

<!-- A group, not a dialog: the plate is docked, it takes no focus of its own
     and Esc does not close it, so the role that promises a window would be
     promising three things it does not do. -->
<div
  class="audio-plate"
  role="group"
  aria-label={t('audio.panel')}
  bind:this={plate}
  style:left={at && `${at.x}px`}
  style:top={at?.top !== undefined ? `${at.top}px` : undefined}
  style:bottom={at?.bottom !== undefined ? `${at.bottom}px` : undefined}
  style:max-height={at && `${at.max}px`}
>
  <header>
    <h2>{t('audio.panel')}</h2>
    <button class="key icon" onclick={close} aria-label={t('audio.close')}>
      <Icon name="x" />
    </button>
  </header>

  <div class="body">
    <input
      type="file"
      accept="audio/*"
      bind:this={picker}
      onchange={pickTrack}
      hidden
    />

    {#if editor.audio.hasTrack}
      <label class="field">
        <span>{t('audio.name')}</span>
        <input bind:value={editor.audio.name} maxlength={AUDIO_MAX_CREDIT} placeholder={t('audio.name_placeholder')} />
      </label>
      <label class="field">
        <span>{t('audio.author')}</span>
        <input bind:value={editor.audio.author} maxlength={AUDIO_MAX_CREDIT} placeholder={t('audio.author_placeholder')} />
      </label>

      <label class="toggle">
        <span>
          <span id="{uid}-tie">{t('audio.tie')}</span>
          <small id="{uid}-tie-hint">
            {editor.audio.sync
              ? t('audio.tie_on')
              : t('audio.tie_off')}
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-labelledby="{uid}-tie"
          aria-describedby="{uid}-tie-hint"
          bind:checked={editor.audio.sync} />
      </label>

      <p class="lengths">
        {t('audio.film')} <b>{clock(filmSeconds)}</b>, {t('audio.track')} <b>{clock(editor.audio.duration)}</b>
      </p>
      {#if trackOutruns}
        <p class="hint">{t('audio.outruns')}</p>
      {/if}

      <div class="row">
        <button class="key wide" bind:this={replaceKey} onclick={() => picker?.click()}>{t('audio.replace')}</button>
        <button class="key icon" onclick={removeTrack} title={t('audio.remove')} aria-label={t('audio.remove')}>
          <Icon name="trash" size={16} />
        </button>
      </div>
    {:else}
      <p class="hint">{t('audio.pitch')}</p>
      <button class="key wide" onclick={() => picker?.click()}>{t('audio.pick')}</button>
      <p class="hint">{t('audio.formats')}</p>
    {/if}

    <p class="sr-only" role="status">
      {#if editor.audio.loading}{t('audio.reading')}{:else}{loadedNote}{/if}
    </p>
    {#if editor.audio.loading}
      <p class="hint" aria-hidden="true">{t('audio.reading')}</p>
    {/if}

    {#if editor.audio.error}
      <p class="hint error" role="alert">{editor.audio.error}</p>
    {/if}
  </div>
</div>

<style>
  .audio-plate {
    position: fixed;
    z-index: var(--z-float);
    display: flex;
    flex-direction: column;
    /* Fixed, so `100%` would be the whole window. The viewport clamp this
       replaced meant nothing either:
       18rem is 288px and the narrowest screen the studio is built for is 320,
       where the clamp sat 32px above the width it was capping. */
    width: 18rem;
    /* 200 % text on a phone made it 1210 px tall in a 640 px window, its top
       — the × and both fields — out of reach above the edge. */
    max-height: 100dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Over the stage by tone, as the scale window: white read as the sheet. */
    background: var(--paper);
    border: none;
    border-radius: var(--r-md);
  }
  /* Mobile: a bottom drawer instead of a floating plate, as the layers list. */
  @media (max-width: 40rem) {
    .audio-plate {
      inset: auto 0 0 0;
      width: auto;
      border-radius: var(--r-md) var(--r-md) 0 0;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.4rem 0.4rem 0.75rem;
    border-bottom: 1px solid var(--hairline);
  }
  header h2 {
    margin: 0;
    font-size: 0.95rem;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.75rem 0.8rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.78rem;
    color: var(--ink-2);
  }
  .field input {
    height: var(--key-h);
    padding: 0 0.45rem;
    font: inherit;
    font-size: 0.88rem;
    color: var(--ink);
    background: var(--canvas);
    border: 1px solid var(--edge);
    border-radius: var(--r-sm, 7px);
  }
  /* The ring belongs to the system (tokens.css): 3px electric at 2px offset,
     what every other field in both packages wears. This rule only tints the
     line underneath it. It used to drop the ring and keep the tint — a quarter
     of the promised indicator, winning on specificity rather than on a
     decision. */
  .field input:focus-visible {
    border-color: var(--accent);
  }
  .toggle {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.86rem;
    color: var(--ink);
  }
  .toggle small {
    display: block;
    margin-top: 0.1rem;
    font-size: 0.74rem;
    line-height: 1.3;
    color: var(--ink-2);
    text-wrap: pretty;
  }
  .toggle input {
    flex: none;
    margin-top: 0.15rem;
  }
  .lengths {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .lengths b {
    color: var(--ink);
  }
  .hint {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.35;
    color: var(--ink-2);
    text-wrap: pretty;
  }
  /* DESIGN's Signal Rule reserves red for the "draw" action — errors stay ink. */
  .hint.error {
    font-weight: 600;
    color: var(--ink);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .row {
    display: flex;
    gap: 0.35rem;
  }
  /* Grow, not `flex: 1`: a zero basis cost the key its height in the empty
     plate's column, where «Выбрать файл…» stood 27 px tall. */
  .wide {
    flex-grow: 1;
    justify-content: center;
  }
</style>
