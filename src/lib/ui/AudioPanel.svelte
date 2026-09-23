<script lang="ts">
  // Floating soundtrack panel: everything about the track that is not the wave
  // itself. The wave stays on the timeline, where it lines up with the frames;
  // the file, its credits and the bin live here, off the strip, because a row
  // of fields under the frames was in the way of the frames.
  import type { EditorState } from './editor-state.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

  let { editor, onClose }: { editor: EditorState; onClose: () => void } = $props();

  let picker = $state<HTMLInputElement | undefined>();

  async function pickTrack(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // picking the same file twice must fire change again
    if (file) {
      await editor.audio.load(file, file.name.replace(/\.[^.]+$/, ''), editor.audio.author);
    }
  }

  function removeTrack(): void {
    if (!editor.warnings || confirm(t('audio.remove_confirm'))) {
      editor.audio.clear();
      onClose();
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

<!-- A group, not a dialog: the plate is docked, it takes no focus of its own
     and Esc does not close it, so the role that promises a window would be
     promising three things it does not do. -->
<div class="audio-plate" role="group" aria-label={t('audio.panel')}>
  <header>
    <h2>{t('audio.panel')}</h2>
    <button class="key icon" onclick={onClose} aria-label={t('audio.close')}>
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
        <input bind:value={editor.audio.name} placeholder={t('audio.name_placeholder')} />
      </label>
      <label class="field">
        <span>{t('audio.author')}</span>
        <input bind:value={editor.audio.author} placeholder={t('audio.author_placeholder')} />
      </label>

      <label class="toggle">
        <span>
          {t('audio.tie')}
          <small>
            {editor.audio.sync
              ? t('audio.tie_on')
              : t('audio.tie_off')}
          </small>
        </span>
        <input type="checkbox" role="switch" bind:checked={editor.audio.sync} />
      </label>

      <p class="lengths">
        {t('audio.film')} <b>{clock(filmSeconds)}</b>, {t('audio.track')} <b>{clock(editor.audio.duration)}</b>
      </p>
      {#if trackOutruns}
        <p class="hint">{t('audio.outruns')}</p>
      {/if}

      <div class="row">
        <button class="key wide" onclick={() => picker?.click()}>{t('audio.replace')}</button>
        <button class="key icon" onclick={removeTrack} title={t('audio.remove')} aria-label={t('audio.remove')}>
          <Icon name="trash" size={16} />
        </button>
      </div>
    {:else}
      <p class="hint">{t('audio.pitch')}</p>
      <button class="key wide" onclick={() => picker?.click()}>{t('audio.pick')}</button>
      <p class="hint">{t('audio.formats')}</p>
    {/if}

    {#if editor.audio.error}
      <p class="hint error" role="alert">{editor.audio.error}</p>
    {/if}
  </div>
</div>

<style>
  .audio-plate {
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.4rem);
    z-index: var(--z-float);
    display: flex;
    flex-direction: column;
    /* The plate is docked to its key, so `100%` here is that key's wrapper
       and means nothing. The viewport clamp it replaced meant nothing either:
       18rem is 288px and the narrowest screen the studio is built for is 320,
       where the clamp sat 32px above the width it was capping. */
    width: 18rem;
    background: var(--canvas);
    border: none;
    border-radius: var(--r-md);
  }
  /* Mobile: a bottom drawer instead of a floating plate, as the layers list. */
  @media (max-width: 40rem) {
    .audio-plate {
      position: fixed;
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
  .row {
    display: flex;
    gap: 0.35rem;
  }
  .wide {
    flex: 1;
    justify-content: center;
  }
</style>
