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
  import { onDestroy, tick, untrack } from 'svelte';
  import type { EditorState } from './editor-state.svelte';
  import { EXPORT_DEFAULT_WIDTH, EXPORT_WIDTHS } from '../format/constants';
  import { frameCount } from '../model/operations';
  import { exportGif } from '../export/export-gif';
  import { exportPng } from '../export/png';
  import { WATERMARK_TEXT, exportSize, exportWidths, logicalSize, startWidth, throwIfAborted, type ExportStage } from '../export/rasterize';
  import { FileWriteError, exportFrameCount, exportVideo, planVideo, type VideoPlan } from '../export/video';
  import Icon from './Icon.svelte';
  import { pickSaveFile, saveFile as save } from './save-file';
  import { plugins } from '../plugins';
  import { makeScene } from '../plugins/scene';
  import { formatPercent, t } from '../i18n';
  import { formatFileSize } from './file-size';

  // `onPublish` is the studio's send key, where the host publishes: the file
  // made is half of the loop, the link a friend opens is the other.
  let { editor, onOpen, onPublish }: { editor: EditorState; onOpen?: () => void; onPublish?: () => void } = $props();

  /** A plugin's format is its register id behind a prefix, so it cannot pass for ours. */
  type Format = 'project' | 'png' | 'gif' | 'video' | `plugin:${string}`;

  let open = $state(false);
  let dialogEl = $state<HTMLDialogElement | undefined>();
  let downloadEl = $state<HTMLButtonElement | undefined>();
  let cancelEl = $state<HTMLButtonElement | undefined>();
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
  /** The save picker is up or on its way: `busy` is not set until it answers. */
  let picking = false;
  /**
   * What the last export made: its weight, and — a picture — an address to
   * show it by. «Файл готов» alone left the author looking at nothing.
   */
  let result = $state<{ url: string | null; bytes: number } | null>(null);
  function forget(): void {
    if (result?.url) {
      URL.revokeObjectURL(result.url);
    }
    result = null;
  }

  // «Файл готов · 27 КБ» and its picture are about the file that was made:
  // under another format, size or switch they described a file nobody built.
  $effect(() => {
    void format;
    void width;
    void watermark;
    void transparent;
    untrack(() => {
      if (!busy) {
        forget();
        stage = '';
      }
    });
  });

  const singleFrame = $derived(frameCount(editor.doc) === 1);

  // A frame over Safari's canvas area is not on offer: a drawing of an
  // extreme proportion (from a file or the API) loses the widths it cannot
  // be drawn at, and a width left chosen on one of them steps down.
  const offeredWidths = $derived(exportWidths(editor.doc));
  const widthsCut = $derived(!EXPORT_WIDTHS.every((w) => offeredWidths.includes(w)));
  $effect(() => {
    if (!offeredWidths.includes(width)) {
      width = offeredWidths[offeredWidths.length - 1];
    }
  });
  // A sheet starts at its own width: a 4K one at 4K, a standing 1080p at 1080.
  // By the sheet alone, so a width picked since stays picked.
  const ownWidth = $derived(logicalSize(editor.doc).width);
  $effect(() => {
    const own = ownWidth;
    width = untrack(() => startWidth(own, offeredWidths));
  });

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
  // Asked only while the sheet is up: the button is always mounted, and every
  // stroke is a new document — each one sent the encoders a round of
  // `isConfigSupported` for a sheet nobody had opened. An answer for a width
  // since changed is not written over the newer one's, and an encoder that
  // throws is an encoder that is not there.
  $effect(() => {
    if (!open) {
      return;
    }
    const hasAudio = editor.audio.hasTrack;
    const target = width;
    let current = true;
    planned = false;
    planVideo(editor.doc, hasAudio, target)
      .catch(() => null)
      .then((result) => {
        if (current) {
          plan = result;
          planned = true;
        }
      });
    return () => {
      current = false;
    };
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
      downloadEl?.focus();
    }
  });

  function track(done: number, total: number, at: ExportStage): void {
    progress = Math.round((done / total) * 100);
    stage = STAGES[at];
  }

  async function download(): Promise<void> {
    // A second press while the picker comes up (a double click, a held Enter):
    // the browser refuses a second picker, which read as «no picker here» —
    // and that press built the video in memory beside the first one.
    if (busy || picking) {
      return;
    }
    // Where the browser can write a file itself, a WebCodecs video goes
    // straight to disk instead of into memory whole. The picker has to open
    // inside the click, so it comes before anything else is awaited; closed,
    // it means «не надо».
    // The plan is the one on the button that was pressed: another may land
    // while the picker is up, for a width or a track since changed.
    const videoPlan = format === 'video' ? plan : null;
    let file: Awaited<ReturnType<typeof pickSaveFile>> = null;
    if (videoPlan && !videoPlan.realtime) {
      picking = true;
      try {
        file = await pickSaveFile(`toonop.${videoPlan.extension}`, `video/${videoPlan.extension}`);
      } catch {
        return;
      } finally {
        picking = false;
      }
    }
    // TODO(toonio-file-parity): force a draft save before the export, as the
    // reference does (`toon.js:265`) — the hook arrives with that change.
    busy = format;
    stage = STAGES.render;
    progress = 0;
    error = '';
    cancelling = new AbortController();
    forget();
    // «Скачать» goes disabled under the finger, and a disabled key drops the
    // focus to the page: it goes to «Отменить», the one thing left to do, and
    // back to «Скачать» when the file is out or the build is called off.
    void tick().then(() => cancelEl?.focus());
    const signal = cancelling.signal;
    // A frame the encoder had in flight ends after «Отменить» and reports
    // itself: the sheet, idle by then, showed «Кодирование…» for good.
    const onProgress: typeof track = (...args) => void (signal.aborted || track(...args));
    const options = { width, watermark, signal, onProgress };
    // PNG takes no signal, and a plugin's format may ignore the one it gets:
    // a file built after «Отменить» is not handed over all the same.
    // Said when it is out: a video streamed to disk has no download of the
    // browser's to show, and the sheet went back to idle without a word.
    let saved = false;
    const deliver = (blob: Blob, name: string) => {
      throwIfAborted(signal);
      save(blob, name);
      saved = true;
      result = { url: blob.type.startsWith('image/') ? URL.createObjectURL(blob) : null, bytes: blob.size };
    };
    try {
      if (format === 'project') {
        // The project, not a picture of it: the document exactly as the draft
        // and the API hold it, the same file Alt+S writes in the Toonio preset.
        deliver(
          new Blob([JSON.stringify(editor.doc)], { type: 'application/octet-stream' }),
          'toonop.toonop',
        );
      } else if (pluginFormat) {
        const file = await pluginFormat.run(makeScene(editor.doc, editor.activeFrame), signal);
        deliver(file.blob, file.name);
      } else if (format === 'png') {
        deliver(await exportPng(editor.doc, { width, watermark, transparent }), 'toonop.png');
      } else if (format === 'gif') {
        const bytes = await exportGif(editor.doc, options);
        deliver(new Blob([bytes], { type: 'image/gif' }), 'toonop.gif');
      } else if (videoPlan) {
        const sink = file ? await file.createWritable().catch(() => Promise.reject(new FileWriteError())) : undefined;
        const blob = await exportVideo(editor.doc, {
          ...options,
          plan: videoPlan,
          audio: editor.audio.blob,
          trackSeconds,
          sink,
          discard: file?.remove?.bind(file),
        });
        if (blob) {
          deliver(blob, `toonop.${videoPlan.extension}`);
        }
        saved = true;
        file = null;
      }
    } catch (err) {
      // What was picked and not finished is not left behind as an empty or
      // broken video; where `remove` is missing it stays empty.
      void file?.remove?.().catch(() => {});
      if (err instanceof FileWriteError) {
        error = err.message;
      } else if (signal.aborted || (err as { name?: string }).name === 'AbortError') {
        error = t('export.cancelled_msg');
      } else {
        console.warn('export failed:', err);
        error = t('export.failed');
      }
    } finally {
      busy = '';
      stage = saved ? t('export.saved') : '';
      cancelling = null;
      await tick();
      if (open && !dialogEl?.contains(document.activeElement)) {
        downloadEl?.focus();
      }
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
    // Last time's «Экспорт отменён» is not news on a new visit.
    error = '';
    stage = '';
    forget();
    open = true;
  }

  function cancel(): void {
    cancelling?.abort();
  }

  // The sheet goes with its panel, or with the studio when the site moves on:
  // a build left running handed its file over on whatever page came next.
  onDestroy(cancel);
  onDestroy(forget);

  function close(): void {
    cancel();
    dialogEl?.close();
  }

  /** Reference Alt+S: open the export without reaching for the button. */
  export function start(): void {
    openSheet();
  }
</script>

<!-- No button of its own: the studio mounts the sheet once, outside the
     panels, and its «Экспорт» key and Alt+S both call `start()`. -->
{#if open}
  <dialog
    bind:this={dialogEl}
    class="sheet sheet-dialog"
    aria-label={t('export.sheet')}
    onclose={() => {
      open = false;
      cancel();
      forget();
    }}
  >
    <header class="sheet-head">
      <h2>{t('export.sheet')}</h2>
      <button class="key icon" onclick={close} aria-label={t('picker.close')}>
        <Icon name="x" />
      </button>
    </header>

    <div class="sheet-body">
      <h3 class="sheet-hint">{t('export.format')}</h3>
      <div class="choices" role="group" aria-label={t('export.format')}>
        {#if singleFrame}
          <button class="key" class:active={format === 'png'} aria-pressed={format === 'png'} disabled={busy !== ''} onclick={() => (format = 'png')}>PNG</button>
        {/if}
        <button class="key" class:active={format === 'gif'} aria-pressed={format === 'gif'} disabled={busy !== ''} onclick={() => (format = 'gif')}>GIF</button>
        <button
          class="key"
          class:active={format === 'video'}
          aria-pressed={format === 'video'}
          disabled={busy !== '' || (planned && !plan)}
          onclick={() => (format = 'video')}
        >{plan?.label ?? t('export.video')}</button>
        <button
          class="key"
          class:active={format === 'project'}
          aria-pressed={format === 'project'}
          disabled={busy !== ''}
          onclick={() => (format = 'project')}
        >{t('export.project')}</button>
        {#each pluginFormats as entry (entry.id)}
          <button
            class="key"
            class:active={format === `plugin:${entry.id}`}
            aria-pressed={format === `plugin:${entry.id}`}
            title={entry.hint}
            disabled={busy !== ''}
            onclick={() => (format = `plugin:${entry.id}`)}
          >{entry.label}</button>
        {/each}
      </div>

      {#if format !== 'project' && !format.startsWith('plugin:')}
        <h3 class="sheet-hint">{t('export.resolution')}</h3>
        <div
          class="choices"
          role="group"
          aria-label={t('export.resolution')}
          aria-describedby={widthsCut ? 'export-widths-cut' : undefined}
        >
          {#each offeredWidths as w (w)}
            {@const s = exportSize(editor.doc, w)}
            <button class="key" class:active={width === w} aria-pressed={width === w} disabled={busy !== ''} onclick={() => (width = w)}>
              {s.width}×{s.height}
            </button>
          {/each}
        </div>
        {#if widthsCut}
          <p class="note" id="export-widths-cut">{t('export.widths_cut')}</p>
        {/if}

        <label class="toggle">
          <span class="toggle-label">{t('export.watermark', { text: WATERMARK_TEXT })}</span>
          <input type="checkbox" role="switch" disabled={busy !== ''} bind:checked={watermark} />
        </label>
        {#if format === 'png'}
          <label class="toggle">
            <span class="toggle-label">{t('export.transparent')}</span>
            <input type="checkbox" role="switch" disabled={busy !== ''} bind:checked={transparent} />
          </label>
        {/if}
      {/if}

      <!-- The format's own line, under the choice: a title is not seen by a
           finger, nor read by every reader. -->
      {#if pluginFormat?.hint}
        <p class="note">{pluginFormat.hint}</p>
      {/if}

      {#if format === 'project' && editor.audio.hasTrack}
        <p class="note">{t('export.project_no_audio')}</p>
      {/if}

      {#if format === 'video'}
        {#if planned && !plan}
          <p class="note">{t('export.no_video_note')}</p>
        {:else if plan && plan.extension !== 'mp4'}
          <p class="note">
            {t('export.webm_note', { audio: editor.audio.hasTrack ? t('export.mp4_with_audio') : '' })}
          </p>
        {/if}
        {#if editor.audio.hasTrack && editor.audio.duration === 0}
          <!-- A draft's track this browser cannot decode: kept, but not heard. -->
          <p class="note">{t('export.audio_unreadable', { name: editor.audio.name })}</p>
        {:else if editor.audio.hasTrack}
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

      <button bind:this={downloadEl} class="key wide primary download" disabled={busy !== '' || editor.audio.loading || (format === 'video' && (!plan || !planned))} onclick={download}>
        {t('export.download')}
      </button>

      <!-- The stage is announced once per stage, from a region that is there
           before it; the percent is for the eye and the bar, which a reader
           asks for when it wants it instead of hearing it every tick. -->
      <p class="sr-only" role="status">{stage}</p>
      {#if busy}
        <p class="note" aria-hidden="true">{stage} {formatPercent(progress / 100)}</p>
        <progress max="100" value={progress} aria-label={stage}></progress>
        <button bind:this={cancelEl} class="key wide" onclick={cancel}>{t('export.cancel')}</button>
      {:else if stage}
        {#if result?.url}
          <img class="result" src={result.url} alt={t('export.result_alt')} />
        {/if}
        <p class="made" aria-hidden="true">{stage}{#if result}{' · '}{formatFileSize(result.bytes)}{/if}</p>
      {/if}
      {#if error}
        <p class="note" role="alert">{error}</p>
      {/if}
    </div>

    <footer class="sheet-foot">
      <button class="key" onclick={close}>{t('export.done')}</button>
      <!-- The way on, in the foot: under the picture of the file it was below
           the fold on a phone, and the session ended on «Готово». -->
      {#if onPublish && !busy && stage}
        <button class="key" onclick={() => {
          close();
          onPublish();
        }}>
          <Icon name="send" />
          {t('export.publish')}
        </button>
      {/if}
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
    /* A sheet comes up from the edge it stands on (controls.css `studio-pop`):
       a few pixels, and none under reduced motion. Closing is instant — the
       hand is already back on the drawing. */
    --pop-from: 8px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  /* The scrim only fades: moved with the sheet, it showed its own edge. Its
     own keyframe — a browser whose backdrop cannot read the tokens (before
     Safari 17.4) drops the line and the scrim simply stands. */
  .sheet-dialog::backdrop {
    background: var(--scrim);
    animation: scrim-in var(--dur-enter) var(--ease-out);
  }
  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .choices .key.active {
    color: var(--accent-ink);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .wide {
    width: 100%;
    justify-content: center;
  }
  /* Its own gap, the same a section heading takes: the settings above it
     come and go with the format, and the project or a plugin's format has none. */
  .download {
    margin-top: 0.7rem;
  }
  /* A phone lying down: the formats and sizes filled the sheet and the one
     key it is opened for was under the fold. It holds to the bottom edge of
     what scrolls until its own place comes up. */
  @media (max-height: 30rem) {
    /* Heavier than the studio's `.key`, whose `position: relative` comes
       later and left the key where it lay. */
    :global(.editor) .sheet-body > .download {
      position: sticky;
      /* Down in the body's own bottom padding, a hair off the foot. */
      bottom: -0.4rem;
      z-index: 1;
      /* A band of the sheet's own tone around it — hard-edged, not a shadow:
         the sizes scrolling under it showed above and below the key. */
      box-shadow: 0 0 0 0.5rem var(--canvas);
    }
  }
  /* DESIGN's Signal Rule reserves red for the "draw" action — notes stay ink. */
  .note {
    margin: 0.2rem 0;
    font-size: 0.82rem;
    color: var(--ink-2);
  }
  /* The file as it came out, on the white it was drawn on; no taller than
     leaves the keys under it in reach on a phone lying down. */
  .result {
    display: block;
    max-width: 100%;
    max-height: min(14rem, 30dvh);
    margin: 0.7rem auto 0;
    /* White on the white sheet: a hairline says where the picture ends. */
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    /* The end of the work — the picture, the words, a refusal — fades in
       where the bar stood (controls.css `studio-pop`): swapped in one frame,
       it read as the sheet twitching. */
    --pop-from: 0px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  /* Read, not glanced past: the end of the work is said in ink. */
  .made {
    margin: 0.5rem 0 0.6rem;
    font-size: 0.9rem;
    font-weight: 700;
    text-align: center;
    color: var(--ink);
    --pop-from: 0px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  .note[role='alert'] {
    --pop-from: 0px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  progress {
    width: 100%;
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
