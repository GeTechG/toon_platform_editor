<script lang="ts">
  // Floating soundtrack panel: everything about the track that is not the wave
  // itself. The wave stays on the timeline, where it lines up with the frames;
  // the file, its credits and the bin live here, off the strip, because a row
  // of fields under the frames was in the way of the frames.
  import type { EditorState } from './editor-state.svelte';
  import Icon from './Icon.svelte';

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
    if (!editor.warnings || confirm('Убрать звук? Отменить это будет нельзя.')) {
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

<div class="audio-plate" role="dialog" aria-label="Звук">
  <header>
    <h2>Звук</h2>
    <button class="key icon" onclick={onClose} aria-label="Закрыть звук">
      <Icon name="x" />
    </button>
  </header>

  <div class="body">
    <input
      type="file"
      accept="audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav"
      bind:this={picker}
      onchange={pickTrack}
      hidden
    />

    {#if editor.audio.hasTrack}
      <label class="field">
        <span>Название</span>
        <input bind:value={editor.audio.name} placeholder="Без названия" />
      </label>
      <label class="field">
        <span>Автор</span>
        <input bind:value={editor.audio.author} placeholder="Кто написал" />
      </label>

      <p class="lengths">
        Мультик <b>{clock(filmSeconds)}</b>, трек <b>{clock(editor.audio.duration)}</b>
      </p>
      {#if trackOutruns}
        <p class="hint">На ленте видно только начало трека — столько, сколько длится мультик.</p>
      {/if}

      <div class="row">
        <button class="key wide" onclick={() => picker?.click()}>Заменить файл…</button>
        <button class="key icon" onclick={removeTrack} title="Убрать звук" aria-label="Убрать звук">
          <Icon name="trash" size={16} />
        </button>
      </div>
    {:else}
      <p class="hint">Под кадрами пойдёт волна, а просмотр и видео — со звуком.</p>
      <button class="key wide" onclick={() => picker?.click()}>Выбрать файл…</button>
      <p class="hint">mp3, ogg или wav</p>
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
    z-index: 6;
    display: flex;
    flex-direction: column;
    width: min(18rem, calc(100vw - 2rem));
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    box-shadow: 0 12px 28px -12px rgba(15, 23, 60, 0.35);
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
    color: var(--ink-2, #555);
  }
  .field input {
    height: var(--key-h);
    padding: 0 0.45rem;
    font: inherit;
    font-size: 0.88rem;
    color: var(--ink);
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm, 5px);
  }
  .field input:focus {
    border-color: var(--electric, #2f5bff);
    outline: none;
  }
  .lengths {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ink-2, #555);
    font-variant-numeric: tabular-nums;
  }
  .lengths b {
    color: var(--ink);
  }
  .hint {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.35;
    color: var(--ink-2, #555);
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
