import { describe, expect, it } from 'bun:test';
import { FileWriteError, guardSink } from '../export/video';
import { t } from '../i18n';

// Owner's answers after the twelfth audit, the export and plugins sheets.
// 1. Video streams straight into a file where File System Access is there.
// 2. A plugin nobody reviewed asks first.
const UI = new URL('./', import.meta.url).pathname;
const exportSheet = await Bun.file(UI + 'ExportSheet.svelte').text();
const video = await Bun.file(UI + '../export/video.ts').text();

/** A sink that records what happened to it; `failWrites` makes every write reject. */
function recorder(failWrites = false) {
  const log: string[] = [];
  const stream = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    write(chunk) {
      if (failWrites) throw new Error('disk full');
      log.push(`write@${chunk.position}`);
    },
    close() {
      log.push('close');
    },
    abort() {
      log.push('abort');
    },
  });
  return { stream, log };
}

const chunk = { type: 'write' as const, data: new Uint8Array(4), position: 0 };

describe('a video streamed into a file', () => {
  it('commits the file only once it is whole', async () => {
    const sink = recorder();
    const guard = guardSink(sink.stream);
    guard.finish();
    const writer = guard.stream.getWriter();
    await writer.write(chunk);
    await writer.close();
    expect(sink.log).toEqual(['write@0', 'close']);
  });

  it('a close before the end (a cancel) aborts the file instead of committing half of it', async () => {
    const sink = recorder();
    const guard = guardSink(sink.stream);
    const writer = guard.stream.getWriter();
    await writer.write(chunk);
    await writer.close();
    expect(sink.log).toEqual(['write@0', 'abort']);
  });

  it('remembers a failed write, so the sheet can say the file did not write', async () => {
    const guard = guardSink(recorder(true).stream);
    const writer = guard.stream.getWriter();
    await writer.write(chunk).catch(() => {});
    expect(guard.failed()).toBeInstanceOf(Error);
    expect(new FileWriteError()).toBeInstanceOf(Error);
    expect(new FileWriteError().message).toBe(t('export.write_failed'));
  });

  it('streams through mediabunny StreamTarget when there is a sink, the buffer otherwise', () => {
    expect(video).toMatch(/file \? new StreamTarget\(/);
    expect(video).toContain('new BufferTarget()');
  });

  it('asks for the file first, inside the click, and only for the WebCodecs path', () => {
    const download = exportSheet.match(/async function download\(\)[^]*?\n  }\n/)![0];
    expect(download).toMatch(/!plan\.realtime/);
    // The picker comes before the first await that is not the picker itself.
    expect(download.indexOf('pickSaveFile(')).toBeGreaterThan(-1);
    expect(download.indexOf('pickSaveFile(')).toBeLessThan(download.indexOf('busy = format'));
  });

  it('removes the unfinished file after a cancel or a failure, and names a failed write', () => {
    expect(exportSheet).toMatch(/\.remove\?\.\(\)/);
    expect(exportSheet).toMatch(/instanceof FileWriteError[^]*?error = err\.message/);
  });
});

describe('the warning before an unreviewed plugin', () => {
  // Who warns is owner-twelfth-plugin-trust.test.ts: a file, or a foreign catalog.
  it('the warning is on ty, says unchecked and full access, and never says «оп»', () => {
    const words = [t('plugins.warn_title'), t('plugins.warn_body')];
    const body = t('plugins.warn_body');
    expect(body).toMatch(/не провер/);
    expect(body).toMatch(/полный доступ/);
    expect(body).toMatch(/свой страх/);
    expect(body).not.toMatch(/(^|[^а-яё])(вы|вам|ваш)([^а-яё]|$)/i);
    for (const word of words) expect(word).not.toMatch(/(^|[^а-яё])оп([^а-яё]|$)/i);
    expect(t('plugins.warn_install')).toBe('Установить');
    expect(t('plugins.warn_cancel')).toBe('Отмена');
  });
});
