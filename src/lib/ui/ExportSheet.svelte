<script lang="ts">
  /**
   * The reference's export window: the same drawing as GIF, MP4 or WebM, with
   * the soundtrack and an optional watermark on the video. Which video
   * formats appear is what the browser can actually record — mp4 is not
   * offered where it cannot be written (with a track, that takes an AAC
   * encoder the browser may not have), with a line saying so rather than a
   * disabled control with no explanation.
   *
   * A native <dialog> for the same reasons as the settings window: focus
   * trap, Esc, inert page.
   */
  import type { EditorState } from './editor-state.svelte';
  import { exportGif } from '../export/export-gif';
  import {
    WATERMARK_TEXT,
    exportFrameCount,
    exportVideo,
    supportedVideoFormats,
    type VideoFormat,
  } from '../export/video';
  import Icon from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  let open = $state(false);
  let dialogEl = $state<HTMLDialogElement | undefined>();
  /** What is being built right now, empty while idle. */
  let busy = $state('');
  let progress = $state(0);
  let error = $state('');
  let watermark = $state(false);
  let cancelling = $state<AbortController | null>(null);

  // Recomputed when a track arrives: mp4 needs an AAC encoder to carry sound,
  // and a browser without one can still write a silent mp4.
  const formats = $derived(supportedVideoFormats(editor.audio.hasTrack));

  // The file is what the preview sounds like. Tied, the track is pinned to the
  // first frame and restarts with the animation, so the work is one pass of the
  // animation long. Untied, the track just plays underneath, so it is the track
  // that sets the length and the animation loops to fill it — which is what
  // keeps a long song from being cut off at half a second of video.
  const trackSeconds = $derived(
    editor.audio.hasTrack && !editor.audio.sync ? editor.audio.duration : undefined,
  );
  const videoSeconds = $derived(
    exportFrameCount(
      editor.doc.layers[0].frames.length,
      editor.doc.frame_rate,
      trackSeconds,
    ) / editor.doc.frame_rate,
  );
  const clock = (seconds: number) =>
    `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;

  $effect(() => {
    if (open) {
      dialogEl?.showModal();
    }
  });

  /** Hands the browser the finished file. */
  function save(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function run(what: string, build: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    busy = what;
    progress = 0;
    error = '';
    try {
      await build();
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        error = 'Экспорт отменён';
      } else {
        console.warn('export failed:', err);
        error = `${what} не собрался — попробуй ещё раз`;
      }
    } finally {
      busy = '';
      cancelling = null;
    }
  }

  function saveGif(): Promise<void> {
    return run('GIF', async () => {
      const bytes = await exportGif(editor.doc, (done, total) => {
        progress = Math.round((done / total) * 100);
      });
      save(new Blob([bytes], { type: 'image/gif' }), 'animation.gif');
    });
  }

  function saveVideo(format: VideoFormat): Promise<void> {
    return run(format.label, async () => {
      cancelling = new AbortController();
      const blob = await exportVideo(editor.doc, {
        format,
        audio: editor.audio.blob,
        watermark: watermark ? WATERMARK_TEXT : undefined,
        trackSeconds,
        signal: cancelling.signal,
        onProgress: (done, total) => {
          progress = Math.round((done / total) * 100);
        },
      });
      save(blob, `animation.${format.extension}`);
    });
  }

  function cancel(): void {
    cancelling?.abort();
  }

  function close(): void {
    cancel();
    dialogEl?.close();
  }

  /** Reference Alt+S: open the export without reaching for the button. */
  export function start(): void {
    open = true;
  }
</script>

<button
  class="key"
  onclick={() => (open = true)}
  data-key="Alt+S"
  title="Экспорт (Alt+S)"
  aria-label="Экспорт"
>
  <Icon name="download" />
</button>

{#if open}
  <dialog
    bind:this={dialogEl}
    class="sheet sheet-dialog"
    aria-label="Экспорт"
    onclose={() => {
      open = false;
      cancel();
    }}
  >
    <header class="sheet-head">
      <h2>Экспорт</h2>
      <button class="key icon" onclick={close} aria-label="Закрыть">
        <Icon name="x" />
      </button>
    </header>

    <div class="sheet-body">
      <p class="sheet-hint">Картинка</p>
      <button class="key wide" disabled={busy !== ''} onclick={saveGif}>GIF</button>

      <p class="sheet-hint">Видео</p>
      {#if formats.length === 0}
        <p class="note">Этот браузер не умеет записывать видео — остаётся GIF.</p>
      {:else}
        {#if !formats.some((f) => f.extension === 'mp4')}
          <p class="note">
            MP4 {editor.audio.hasTrack ? 'со звуком ' : ''}этот браузер не пишет; WebM откроется в нём
            же и в любом плеере.
          </p>
        {/if}
        <label class="toggle">
          <span class="toggle-label">Водяной знак «{WATERMARK_TEXT}»</span>
          <input type="checkbox" role="switch" bind:checked={watermark} />
        </label>
        {#if editor.audio.hasTrack}
          <p class="note">
            Звук «{editor.audio.name}» войдёт в видео.
            {#if editor.audio.sync}
              Трек привязан к кадрам, поэтому видео длится один проход мультика — как в просмотре.
            {:else}
              Трек не привязан, поэтому он задаёт длину: мультик повторяется, пока играет музыка.
            {/if}
          </p>
        {/if}
        <p class="note">Запись идёт в реальном времени: {clock(videoSeconds)}.</p>
        {#each formats as format (format.mimeType)}
          <button class="key wide" disabled={busy !== ''} onclick={() => saveVideo(format)}>
            {format.label}
          </button>
        {/each}
      {/if}

      {#if busy}
        <p class="note" role="status">{busy}: {progress}%</p>
        <progress max="100" value={progress}></progress>
        {#if cancelling}
          <button class="key wide" onclick={cancel}>Отменить</button>
        {/if}
      {/if}
      {#if error}
        <p class="note" role="alert">{error}</p>
      {/if}
    </div>

    <footer class="sheet-foot">
      <button class="key primary" onclick={close}>Готово</button>
    </footer>
  </dialog>
{/if}

<style>
  /* The shape comes from the shared `.sheet` chrome; a <dialog> only needs
     its own defaults cleared and a backdrop of its own. */
  .sheet-dialog {
    margin: 0;
    padding: 0;
    max-width: none;
    border: none;
    color: var(--ink);
  }
  .sheet-dialog::backdrop {
    background: rgba(11, 12, 16, 0.42);
  }
  .wide {
    width: 100%;
    justify-content: center;
  }
  /* DESIGN's Signal Rule reserves red for the "draw" action — notes stay ink. */
  .note {
    margin: 0.2rem 0;
    font-size: 0.82rem;
    color: var(--ink-2, #555);
  }
  progress {
    width: 100%;
    height: 0.5rem;
  }
</style>
