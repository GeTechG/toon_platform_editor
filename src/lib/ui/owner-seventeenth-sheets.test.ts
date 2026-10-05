import { describe, expect, it } from 'bun:test';

import { guardSink, type FileChunk } from '../export/video';
import { t } from '../i18n';

// Owner's answers after the seventeenth audit — sheets. A video file whose
// encoder never answers is still let go of and deleted on «Отменить», a draft
// id with a space in it keeps its keys tied to its date, and a catalog plugin
// that is installed but did not load can be put in again.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

/** A picked file: records the order of what happened to it. */
function pickedFile() {
  const events: string[] = [];
  const sink = new WritableStream<FileChunk>({
    write: () => {
      events.push('write');
    },
    close: () => {
      events.push('close');
    },
    abort: () => {
      events.push('abort');
    },
  });
  const discard = async () => {
    events.push('discard');
  };
  return { sink, discard, events };
}

describe('видео прямо на диск: кодировщик, который не отвечает', () => {
  it('«Отменить» само закрывает запись и удаляет файл, не дожидаясь кодировщика', async () => {
    const { sink, discard, events } = pickedFile();
    const cancel = new AbortController();
    const file = guardSink(sink, cancel.signal, discard);
    // mediabunny holds the stream and is stuck inside `video.add`: nothing
    // ever closes it from its side.
    file.stream.getWriter();
    cancel.abort();
    await file.drop();
    expect(events).toEqual(['abort', 'discard']);
  });

  it('файл удаляется один раз, сколько бы раз его ни бросали', async () => {
    const { sink, discard, events } = pickedFile();
    const cancel = new AbortController();
    const file = guardSink(sink, cancel.signal, discard);
    cancel.abort();
    await Promise.all([file.drop(), file.drop()]);
    expect(events.filter((event) => event === 'discard')).toHaveLength(1);
  });

  it('готовое видео не удаляется «Отменить», нажатым после конца', async () => {
    const { sink, discard, events } = pickedFile();
    const cancel = new AbortController();
    const file = guardSink(sink, cancel.signal, discard);
    file.finish();
    await file.stream.getWriter().close();
    cancel.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['close']);
  });

  it('экспорт отдаёт сигнал и удаление самой записи', async () => {
    const video = await source('../export/video.ts');
    expect(video).toMatch(/guardSink\(sink, signal, discard\)/);
  });
});

describe('черновики: id из чужого файла', () => {
  // The hub's keys act on the pick, not on a row: no id is built from a draft's.
  it('id черновика с пробелами не попадает в DOM id', async () => {
    const editor = await source('./DraftsHub.svelte');
    expect(editor).toMatch(/\{#each drafts as entry \(entry\.id\)\}/);
    expect(editor).not.toMatch(/draft-date-\{entry\.id\}/);
  });
});

describe('каталог: плагин установлен, но не загрузился', () => {
  it('та же версия предлагает переустановить, а не пишет «установлен»', async () => {
    const sheet = await source('./PluginsSheet.svelte');
    const offer = sheet.slice(sheet.indexOf('function offer('), sheet.indexOf('</script>'));
    expect(offer).toMatch(/notLoaded\(mine\)[\s\S]*'reinstall'/);
    expect(sheet).toMatch(/offer\(entry\) === 'reinstall'[\s\S]*t\('plugins\.reinstall'\)/);
    expect(t('plugins.reinstall')).toBe('Установить заново');
  });
});
