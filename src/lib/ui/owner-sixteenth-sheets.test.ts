import { describe, expect, it } from 'bun:test';

// Owner answers after the sixteenth audit, sheets: the project and the drafts
// leave as `application/octet-stream`, so Safari keeps their names instead of
// appending `.json`, and an export under the transform lock takes the live
// move the screen shows, as the export always did without the lock.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

describe('проект и черновики сохраняются под своим именем и в Safari', () => {
  it('«Скачать проект» и «Скачать черновик» в студии — не JSON для браузера', async () => {
    const editor = await source('./Editor.svelte');
    expect(editor).not.toMatch(/type: 'application\/json' \}\), '(toonop\.toonop|draft\.toonops)'/);
    expect(editor).toMatch(/type: 'application\/octet-stream' \}\), 'toonop\.toonop'/);
    expect(editor).toMatch(/type: 'application\/octet-stream' \}\), 'draft\.toonops'/);
  });

  it('проект из листа экспорта — тоже', async () => {
    const sheet = await source('./ExportSheet.svelte');
    expect(sheet).toMatch(/JSON\.stringify\(editor\.doc\)\], \{ type: 'application\/octet-stream' \}\)/);
  });

  it('черновики из настроек — тоже, а палитры в .json остаются JSON', async () => {
    const settings = await source('./SettingsSheet.svelte');
    expect(settings).toMatch(/name\.endsWith\('\.json'\) \? 'application\/json' : 'application\/octet-stream'/);
  });
});

describe('экспорт под замком трансформации', () => {
  it('лист экспорта применяет живой сдвиг и при замке, а не выгружает рисунок без него', async () => {
    const editor = await source('./Editor.svelte');
    const open = editor.match(/<ExportSheet[^]*?onOpen=\{\(\) => \{([^]*?)\}\}/)![1];
    expect(open).toContain('editor.commitTransform()');
    expect(open).not.toContain('editor.leaveTransform()');
  });
});
