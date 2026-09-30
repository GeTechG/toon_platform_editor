import { afterEach, describe, expect, it } from 'bun:test';

import { exportDrafts, saveDraft, setDraftAudio, setDraftScreenshot } from '../draft/store';
import { createDocument } from '../model/operations';
import { PLUGIN_API } from '../plugins/contract';
import { installFromFile } from '../plugins/install';
import { makeHost } from '../plugins/host';
import { PluginRegistry } from '../plugins/registry';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';
import { createErrorLog } from './error-log';
import { t } from '../i18n';

// Seventeenth audit — sheets: document files, export and plugins. Behavioural
// tests for what the person sees: a plugin that lives only until a reload is
// not lost to a refused new build of it, the «Открыть» picker takes a drafts
// file as drafts, one unreadable blob does not cost the whole drafts backup,
// and the Alt+L log keeps the failures the studio reports as warnings.

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

/** Silence while a test runs: refusals are written to the console on purpose. */
async function quiet<T>(run: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

describe('плагины: новая сборка поверх плагина, которого нет на диске', () => {
  it('отвергнутая сборка не уносит работающий до перезагрузки плагин', async () => {
    const id = 'a.session-only';
    const modules: Record<string, Record<string, unknown>> = {
      good: { default: { id, api: PLUGIN_API, tools: { [id]: { label: id, title: id, key: '', icon: '<path />' } } } },
      // Same id, another editor's contract: the register refuses it.
      foreign: { default: { id, api: PLUGIN_API + 1, tools: { [id]: { label: id, title: id, key: '', icon: '<path />' } } } },
    };
    const ports = { fetch: () => Promise.reject(new Error('no network')), evaluate: async (code: string) => modules[code] };
    const registry = new PluginRegistry();
    // No storage at all: the plugin runs until the page is left.
    expect(await quiet(() => installFromFile('good', registry, ports))).toBe(t('plugins.not_kept'));
    expect(registry.tool(id)).toBeDefined();
    expect(await quiet(() => installFromFile('foreign', registry, ports))).not.toBeNull();
    expect(registry.tool(id)).toBeDefined();
  });
});

describe('«Открыть файл»: черновики', () => {
  it('файл черновиков из выбора открывается как черновики, как и брошенный на окно', async () => {
    const editor = await source('./Editor.svelte');
    const picker = editor.slice(editor.indexOf('bind:this={fileInput}'), editor.indexOf('{#snippet history()}'));
    expect(picker).toMatch(/DRAFTS_FILE\.test\(file\.name\)\s*\)?\s*\{?\s*void openDraftsFile\(file\)/);
  });
});

describe('черновики в файл: блоб, который не читается', () => {
  const lost = { size: 4, type: 'image/webp', arrayBuffer: () => Promise.reject(new Error('NotReadableError')) } as unknown as Blob;

  it('потерянная картинка карточки не отменяет сохранение всех черновиков', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', createDocument());
    await saveDraft('b', createDocument());
    await setDraftScreenshot('a', lost);
    const file = JSON.parse(await quiet(() => exportDrafts()));
    expect(file.saves).toHaveLength(2);
    expect(file.saves.find((save: { id: string }) => save.id === 'a').screenshot).toBeUndefined();
  });

  it('трек, который браузер потерял, не держит рисунок: черновик уходит без него', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', createDocument());
    await setDraftAudio('a', { blob: lost, name: 'песня', author: '', sync: true, bytes: 4 });
    const file = JSON.parse(await quiet(() => exportDrafts()));
    expect(file.saves).toHaveLength(1);
    expect(file.saves[0].data).toBeString();
    expect(file.saves[0].audio).toBeUndefined();
  });
});

describe('Alt+L: журнал ошибок', () => {
  it('сбой, о котором студия пишет предупреждением (экспорт, запись черновика), попадает в журнал', () => {
    const log = createErrorLog();
    const con = { error: (..._: unknown[]) => {}, warn: (..._: unknown[]) => {} };
    log.watch({ addEventListener() {} }, con);
    con.warn('export failed:', new Error('encoder gone'));
    expect(log.lines[0]).toContain('export failed:');
    expect(log.lines[0]).toContain('encoder gone');
  });
});

describe('плагины: предупреждение о чужом каталоге', () => {
  it('«Отмена» возвращает фокус в окно: ключ, отключённый на время скачивания, его уже отдал странице', async () => {
    const sheet = await source('./PluginsSheet.svelte');
    const answer = sheet.slice(sheet.indexOf('function answer('), sheet.indexOf('async function askInstall('));
    expect(answer).toMatch(/keepFocus\(\)/);
  });
});

describe('видео прямо на диск: «Отменить»', () => {
  it('выбранный файл удаляется, когда экспорт его отпустил, а не пока держит открытым', async () => {
    const video = await source('../export/video.ts');
    const sheet = await source('./ExportSheet.svelte');
    // The writer is aborted (the lock goes) before the file is deleted.
    expect(video).toMatch(/await file\?\.drop\(\);\s*await discard\?\.\(\)/);
    expect(sheet).toMatch(/discard: file\?\.remove\?\.bind\(file\)/);
  });
});

describe('плагины: каталог слов без русского', () => {
  it('плагин, написавший слова только по-английски, говорит ими, а не отвергается «без label»', () => {
    const id = 'a.english-only';
    const registry = new PluginRegistry();
    const failed = registry.register({
      id,
      api: PLUGIN_API,
      locales: { en: { label: 'Blur', title: 'Blur the line', hello: 'Hi' } },
      tools: { [id]: { label: { t: 'label' }, title: { t: 'title' }, key: '', icon: '<path />' } },
    });
    expect(failed).toBeNull();
    expect(registry.tool(id)?.label).toBe('Blur');
    const host = makeHost({ doc: { width: 1 }, pluginStrokes: () => [], editPluginCells: () => {}, openPluginWindow: () => ({}) as HTMLElement }, id);
    expect(host.t('hello')).toBe('Hi');
  });
});
