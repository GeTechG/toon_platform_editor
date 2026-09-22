<script lang="ts">
  /**
   * The reference's export window: a format, a resolution, a watermark and
   * one «Скачать» button (`index.html:255-300`, `export_help.js:100-133`).
   * PNG appears only for a one-frame document, and only PNG offers a
   * transparent background. The video container is whatever this browser can
   * encode — mp4 where it can, WebM otherwise, with a line saying why.
   *
   * A native <dialog> for the same reasons as the settings window: focus
   * trap, Esc, inert page.
   */
  import type { EditorState } from './editor-state.svelte';
  import { EXPORT_DEFAULT_WIDTH, EXPORT_WIDTHS } from '../format/constants';
  import { frameCount } from '../model/operations';
  import { exportGif } from '../export/export-gif';
  import { exportPng } from '../export/png';
  import { WATERMARK_TEXT, exportSize, type ExportStage } from '../export/rasterize';
  import { exportFrameCount, exportVideo, planVideo, type VideoPlan } from '../export/video';
  import Icon from './Icon.svelte';
  import { plugins } from '../plugins';
  import { makeScene } from '../plugins/scene';
  import { t } from '../i18n';

  let { editor, onOpen }: { editor: EditorState; onOpen?: () => void } = $props();

  /** A plugin's format is its register id behind a prefix, so it cannot pass for ours. */
  type Format = 'project' | 'png' | 'gif' | 'video' | `plugin:${string}`;

  let open = $state(false);
  let dialogEl = $state<HTMLDialogElement | undefined>();
  let format = $state<Format>('gif');
  let width = $state(EXPORT_DEFAULT_WIDTH);
  let watermark = $state(true);
  let transparent = $state(false);
  /** What is being built right now, empty while idle. */
  let busy = $state('');
  let stage = $state('');
  let progress = $state(0);
  let error = $state('');
  let cancelling = $state<AbortController | null>(null);
  let plan = $state<VideoPlan | null>(null);
  let planned = $state(false);

  const singleFrame = $derived(frameCount(editor.doc) === 1);

  /** The formats plugins bring; a plugin that broke takes its button with it. */
  const pluginFormats = $derived.by(() => {
    void editor.pluginsVersion;
    return plugins.exporters();
  });
  const pluginFormat = $derived(pluginFormats.find((entry) => format === `plugin:${entry.id}`));

  // A format whose plugin went away is not a choice any more.
  $effect(() => {
    if (format.startsWith('plugin:') && !pluginFormat) {
      format = singleFrame ? 'png' : 'gif';
    }
  });

  // PNG is a still: the moment there is a second frame it stops being on
  // offer, and a sheet left on it falls back to GIF (`export_help.js:124-126`).
  $effect(() => {
    if (!singleFrame && format === 'png') {
      format = 'gif';
    }
  });

  // Which video path exists is a question for the encoders, and the answer
  // changes when a track arrives: mp4 needs an AAC encoder to carry sound.
  $effect(() => {
    const hasAudio = editor.audio.hasTrack;
    const target = width;
    planned = false;
    planVideo(editor.doc, hasAudio, target).then((result) => {
      plan = result;
      planned = true;
    });
  });

  // The file is what the preview sounds like. Tied, the track is pinned to the
  // first frame and restarts with the animation, so the work is one pass of the
  // animation long. Untied, the track just plays underneath, so it is the track
  // that sets the length and the animation loops to fill it — which is what
  // keeps a long song from being cut off at half a second of video.
  const trackSeconds = $derived(
    editor.audio.hasTrack && !editor.audio.sync ? editor.audio.duration : undefined,
  );
  const videoSeconds = $derived(
    exportFrameCount(frameCount(editor.doc), editor.doc.frame_rate, trackSeconds) /
      editor.doc.frame_rate,
  );
  const clock = (seconds: number) =>
    `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;

  const STAGES: Record<ExportStage, string> = {
    render: t('export.stage_render'),
    encode: t('export.stage_encode'),
  };

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

  function track(done: number, total: number, at: ExportStage): void {
    progress = Math.round((done / total) * 100);
    stage = STAGES[at];
  }

  async function download(): Promise<void> {
    if (busy) {
      return;
    }
    // TODO(toonio-file-parity): force a draft save before the export, as the
    // reference does (`toon.js:265`) — the hook arrives with that change.
    busy = format;
    stage = STAGES.render;
    progress = 0;
    error = '';
    cancelling = new AbortController();
    const options = { width, watermark, signal: cancelling.signal, onProgress: track };
    try {
      if (format === 'project') {
        // The project, not a picture of it: the document exactly as the draft
        // and the API hold it, the same file Alt+S writes in the Toonio preset.
        save(
          new Blob([JSON.stringify(editor.doc)], { type: 'application/json' }),
          'toonop.toonop',
        );
      } else if (pluginFormat) {
        const file = await pluginFormat.run(makeScene(editor.doc, editor.activeFrame));
        save(file.blob, file.name);
      } else if (format === 'png') {
        save(await exportPng(editor.doc, { width, watermark, transparent }), 'toonop.png');
      } else if (format === 'gif') {
        const bytes = await exportGif(editor.doc, options);
        save(new Blob([bytes], { type: 'image/gif' }), 'toonop.gif');
      } else if (plan) {
        const blob = await exportVideo(editor.doc, {
          ...options,
          plan,
          audio: editor.audio.blob,
          trackSeconds,
        });
        save(blob, `toonop.${plan.extension}`);
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        error = t('export.cancelled_msg');
      } else {
        console.warn('export failed:', err);
        error = t('export.failed');
      }
    } finally {
      busy = '';
      stage = '';
      cancelling = null;
    }
  }

  /**
   * A still opens on PNG, an animation on GIF — the reference picks the
   * format the document actually is (`export_help.js:108-126`).
   */
  function openSheet(): void {
    // The reference writes the draft before an export: what is being exported
    // should be on disk before a long encode has a chance to go wrong.
    onOpen?.();
    format = singleFrame ? 'png' : 'gif';
    open = true;
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
    openSheet();
  }
</script>

<button
  class="key"
  onclick={openSheet}
  data-key="Alt+S"
  title={t('export.title')}
  aria-label={t('export.sheet')}
>
  <Icon name="download" />
</button>

{#if open}
  <dialog
    bind:this={dialogEl}
    class="sheet sheet-dialog"
    aria-label={t('export.sheet')}
    onclose={() => {
      open = false;
      cancel();
    }}
  >
    <header class="sheet-head">
      <h2>{t('export.sheet')}</h2>
      <button class="key icon" onclick={close} aria-label={t('picker.close')}>
        <Icon name="x" />
      </button>
    </header>

    <div class="sheet-body">
      <p class="sheet-hint">{t('export.format')}</p>
      <div class="choices" role="group" aria-label={t('export.format')}>
        {#if singleFrame}
          <button class="key" class:active={format === 'png'} aria-pressed={format === 'png'} onclick={() => (format = 'png')}>PNG</button>
        {/if}
        <button class="key" class:active={format === 'gif'} aria-pressed={format === 'gif'} onclick={() => (format = 'gif')}>GIF</button>
        <button
          class="key"
          class:active={format === 'video'}
          aria-pressed={format === 'video'}
          disabled={planned && !plan}
          onclick={() => (format = 'video')}
        >{plan?.label ?? t('export.video')}</button>
        <button
          class="key"
          class:active={format === 'project'}
          aria-pressed={format === 'project'}
          onclick={() => (format = 'project')}
        >{t('export.project')}</button>
        {#each pluginFormats as entry (entry.id)}
          <button
            class="key"
            class:active={format === `plugin:${entry.id}`}
            aria-pressed={format === `plugin:${entry.id}`}
            title={entry.hint}
            onclick={() => (format = `plugin:${entry.id}`)}
          >{entry.label}</button>
        {/each}
      </div>

      {#if format !== 'project' && !format.startsWith('plugin:')}
        <p class="sheet-hint">{t('export.resolution')}</p>
        <div class="choices" role="group" aria-label={t('export.resolution')}>
          {#each EXPORT_WIDTHS as w (w)}
            {@const s = exportSize(editor.doc, w)}
            <button class="key" class:active={width === w} aria-pressed={width === w} onclick={() => (width = w)}>
              {s.width}×{s.height}
            </button>
          {/each}
        </div>

        <label class="toggle">
          <span class="toggle-label">{t('export.watermark', { text: WATERMARK_TEXT })}</span>
          <input type="checkbox" role="switch" bind:checked={watermark} />
        </label>
        {#if format === 'png'}
          <label class="toggle">
            <span class="toggle-label">{t('export.transparent')}</span>
            <input type="checkbox" role="switch" bind:checked={transparent} />
          </label>
        {/if}
      {/if}

      {#if format === 'video'}
        {#if planned && !plan}
          <p class="note">{t('export.no_video_note')}</p>
        {:else if plan && plan.extension !== 'mp4'}
          <p class="note">
            {t('export.webm_note', { audio: editor.audio.hasTrack ? t('export.mp4_with_audio') : '' })}
          </p>
        {/if}
        {#if editor.audio.hasTrack}
          <p class="note">
            {t('export.audio_note', { name: editor.audio.name })}
            {#if editor.audio.sync}
              {t('export.audio_tied')}
            {:else}
              {t('export.audio_untied')}
            {/if}
          </p>
        {/if}
        {#if plan?.realtime}
          <p class="note">{t('export.realtime', { clock: clock(videoSeconds) })}</p>
        {/if}
      {/if}

      <button class="key wide primary" disabled={busy !== '' || (format === 'video' && !plan)} onclick={download}>
        {t('export.download')}
      </button>

      <!-- The stage is announced once per stage, from a region that is there
           before it; the percent is for the eye and the bar, which a reader
           asks for when it wants it instead of hearing it every tick. -->
      <p class="sr-only" role="status">{stage}</p>
      {#if busy}
        <p class="note" aria-hidden="true">{stage} {progress}%</p>
        <progress max="100" value={progress} aria-label={stage}></progress>
        <button class="key wide" onclick={cancel}>{t('export.cancel')}</button>
      {/if}
      {#if error}
        <p class="note" role="alert">{error}</p>
      {/if}
    </div>

    <footer class="sheet-foot">
      <button class="key primary" onclick={close}>{t('export.done')}</button>
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
    background: var(--scrim);
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .choices .key.active {
    color: var(--electric);
    box-shadow: inset 0 0 0 2px var(--electric);
  }
  .wide {
    width: 100%;
    justify-content: center;
  }
  /* DESIGN's Signal Rule reserves red for the "draw" action — notes stay ink. */
  .note {
    margin: 0.2rem 0;
    font-size: 0.82rem;
    color: var(--ink-2);
  }
  progress {
    width: 100%;
    height: 0.5rem;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
