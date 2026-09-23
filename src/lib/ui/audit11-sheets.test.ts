import { afterEach, describe, expect, it, mock } from 'bun:test';

import { createErrorLog } from './error-log';
import { putInstalled, removeInstalled, type InstalledPlugin } from '../plugins/store';
import { forPerson, installFromFile } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { PLUGIN_API } from '../plugins/contract';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';
import { t } from '../i18n';

// Одиннадцатый аудит, листы и файлы: экспорт, плагины, настройки, файлы.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const exportSheet = await source('./ExportSheet.svelte');
const pluginsSheet = await source('./PluginsSheet.svelte');
const settingsSheet = await source('./SettingsSheet.svelte');
const editorSvelte = await source('./Editor.svelte');
const editorState = await source('./editor-state.svelte.ts');
const exportGif = await source('../export/export-gif.ts');

const record = (id: string): InstalledPlugin => ({
  id,
  version: '1.0.0',
  name: id,
  description: '',
  icon: '',
  code: 'export default {}',
  source: 'local',
  installed: 1,
});

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('Alt+L: журнал ошибок', () => {
  it('хранит стек ошибки, переданной в console.error, а не одно «Error: …»', () => {
    const log = createErrorLog();
    const con = { error: (..._: unknown[]) => {} };
    log.watch({ addEventListener() {} }, con);
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at draw (canvas.ts:12:3)';
    con.error('render failed:', err);
    expect(log.lines[0]).toContain('render failed:');
    expect(log.lines[0]).toContain('at draw (canvas.ts:12:3)');
  });

  it('объект в console.error — его поля, не «[object Object]»', () => {
    const log = createErrorLog();
    const con = { error: (..._: unknown[]) => {} };
    log.watch({ addEventListener() {} }, con);
    con.error('refused:', { id: 'halftone', code: 42 });
    expect(log.lines[0]).not.toContain('[object Object]');
    expect(log.lines[0]).toContain('halftone');
  });
});

describe('плагины: хранилище, которое не приняло запись', () => {
  it('запись и удаление говорят, дошли ли они до диска', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    expect(await putInstalled(record('a'))).toBe(true);
    expect(await removeInstalled('a')).toBe(true);
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    const warn = console.warn;
    console.warn = mock(() => {});
    try {
      expect(await putInstalled(record('a'))).toBe(false);
      expect(await removeInstalled('a')).toBe(false);
    } finally {
      console.warn = warn;
    }
  });

  it('установка без хранилища не пишет «установлен»: плагин работает до перезагрузки', async () => {
    const warn = console.warn;
    console.warn = mock(() => {});
    try {
      const registry = new PluginRegistry();
      const failed = await installFromFile('code', registry, {
        fetch: async () => ({ text: async () => '' }),
        evaluate: async () => ({
          default: { id: 'mine', api: PLUGIN_API, tools: { mine: { label: 'mine', title: 'mine', key: '', icon: '<path />' } } },
        }),
      });
      expect(failed).toBe(t('plugins.not_kept'));
      // Он всё-таки в работе, до конца визита.
      expect(registry.tool('mine')).toBeDefined();
      // И эту причину человек видит как есть — ему есть что с ней делать.
      expect(forPerson(failed!)).toBe(t('plugins.not_kept'));
    } finally {
      console.warn = warn;
    }
  });

  it('удаление, которое хранилище не приняло, так и называется', () => {
    expect(editorState).toMatch(/async removePlugin\(id: string\): Promise<boolean>[^]*?return kept;/);
    expect(pluginsSheet).toMatch(/const kept = await editor\.removePlugin\(plugin\.id\)[^]*?plugins\.remove_not_kept/);
    expect(t('plugins.remove_not_kept', { name: 'X' })).toMatch(/^X /);
  });
});

describe('плагины: окно', () => {
  it('«поставлен файлом» одним словом в обеих вкладках', () => {
    expect(t('plugins.local')).toBe(t('plugins.source_local'));
  });

  it('вкладки не липнут к линии под заголовком', () => {
    expect(pluginsSheet).toMatch(/\.tabs \{[^}]*padding: 0\.6rem 1rem 0;/);
  });
});

describe('экспорт', () => {
  it('упавший воркер GIF останавливает рендер, а не гонит оба прохода впустую', () => {
    expect(exportGif).toMatch(/let settled = false;/);
    expect(exportGif).toMatch(/const done = \(settle: \(\) => void\) => \{\s*settled = true;/);
    expect(exportGif.match(/if \(settled\) \{\s*break;\s*\}/g)?.length).toBe(2);
    // Отказ до `return bytes` — не «необработанный» в журнале Alt+L.
    expect(exportGif).toContain('bytes.catch(() => {});');
  });

  it('проект с треком говорит, что звук в файл не входит', () => {
    expect(exportSheet).toMatch(/\{#if format === 'project' && editor\.audio\.hasTrack\}\s*<p class="note">\{t\('export\.project_no_audio'\)\}<\/p>/);
    expect(t('export.project_no_audio')).toContain('черновик');
  });
});

describe('черновики из файла', () => {
  it('отчёт без «повреждено 0» и с тем, что загружено', () => {
    expect(t('settings.drafts_loaded', { loaded: 3 })).toBe('Загружено черновиков: 3');
    expect(t('settings.drafts_loaded_broken', { loaded: 3, broken: 1 })).toBe(
      'Загружено черновиков: 3, повреждённых пропущено: 1',
    );
    for (const text of [settingsSheet, editorSvelte]) {
      expect(text).toContain("broken > 0 ? 'settings.drafts_loaded_broken' : 'settings.drafts_loaded'");
    }
  });

  it('загруженные черновики отмечены для скачивания, как и остальные', () => {
    expect(settingsSheet).toMatch(/const before = new Set\(drafts\.map\(\(entry\) => entry\.id\)\);[^]*?chosen = \[\.\.\.chosen, \.\.\.drafts\.filter\(\(entry\) => !before\.has\(entry\.id\)\)/);
  });
});

describe('открытие файла', () => {
  it('всегда спрашивает «заменить рисунок?», а черновик пишется до замены', () => {
    // Alt+Enter no longer mutes the question (owner-twelfth-shell).
    expect(editorSvelte).toMatch(/if \(editor\.touched\) \{[^]*?if \(!confirm\(t\(question[^]*?await saveNow\(true\)/);
  });
});
