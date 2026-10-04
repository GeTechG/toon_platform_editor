import { describe, expect, it } from 'bun:test';

// Twentieth audit — sheets: files, export and plugins. A second press on
// «Скачать» while the save picker is still coming up does not start a second
// build beside the first.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

describe('экспорт: «Скачать» нажата дважды, пока открывается окно сохранения', () => {
  it('второе нажатие не начинает вторую сборку', async () => {
    const sheet = await source('./ExportSheet.svelte');
    const download = sheet.slice(sheet.indexOf('async function download()'), sheet.indexOf('function openSheet()'));
    // `busy` is set only after the picker answers: the browser refuses a
    // second picker («already active»), `pickSaveFile` takes that for «no
    // picker here», and the second press built the video in memory while the
    // first one waited for a file name — two builds, two files.
    const guard = download.slice(0, download.indexOf('await pickSaveFile'));
    expect(guard).toMatch(/if \(busy \|\| picking\) \{\s*return;/);
    expect(guard).toMatch(/picking = true;/);
    // Let go whatever the picker said — a file, «не надо», or no picker at all.
    expect(download).toMatch(/finally \{\s*picking = false;/);
  });
});
