import { afterEach, describe, expect, it, mock } from 'bun:test';

import { createErrorLog } from './error-log';
import { formatFileSize } from './file-size';
import { editCells } from '../plugins/host';
import { putInstalled, removeInstalled, listInstalled, type InstalledPlugin } from '../plugins/store';
import { loadInstalled, updateInstalled } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { PLUGIN_API, type PluginScene } from '../plugins/contract';
import { saveDraft } from '../draft/store';
import { decodeToon } from '../format/toon-decode';
import { validateDocument } from '../format/validate';
import { MAX_FRAMES, SCHEMA_VERSION } from '../format/constants';
import type { ToolDescriptor, ToonDocument } from '../format/types';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';
import { t } from '../i18n';

// Двенадцатый аудит, листы и файлы: экспорт, плагины, настройки, файлы.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const exportSheet = await source('./ExportSheet.svelte');
const editorState = await source('./editor-state.svelte.ts');
const exportGif = await source('../export/export-gif.ts');

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  const error = console.error;
  console.warn = mock(() => {});
  console.error = mock(() => {});
  try {
    return await run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
};

const hung = <T>(promise: Promise<T>, ms = 300) =>
  Promise.race([promise, new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), ms))]);

/**
 * An IndexedDB whose disk is full: every readwrite transaction aborts with
 * QuotaExceededError at commit — the way a real browser reports it, through
 * `abort` on the transaction and never through `error`.
 */
function fullIndexedDB(): unknown {
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      const tx: Record<string, unknown> & { onabort?: () => void; oncomplete?: () => void } = {
        error: new DOMException('quota', 'QuotaExceededError'),
      };
      const abort = () => queueMicrotask(() => tx.onabort?.());
      tx.objectStore = () => ({
        get() {
          const req: { result?: unknown; onsuccess?: () => void } = {};
          queueMicrotask(() => req.onsuccess?.());
          return req;
        },
        getAll() {
          const req: { result: unknown[]; onsuccess?: () => void } = { result: [] };
          queueMicrotask(() => req.onsuccess?.());
          return req;
        },
        put: () => (abort(), {}),
        delete: () => (abort(), {}),
      });
      return tx;
    },
  };
  return {
    open() {
      const req: { result: unknown; onsuccess?: () => void } = { result: db };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
}

const record = (id: string, version = '1.0.0'): InstalledPlugin => ({
  id,
  version,
  name: id,
  description: '',
  icon: '',
  code: `old:${id}`,
  source: 'catalog',
  installed: 1,
});

describe('нехватка места: транзакция, отменённая квотой', () => {
  it('установка плагина не висит, а говорит «не записано»', async () => {
    setIndexedDB(fullIndexedDB());
    expect(await quiet(() => hung(putInstalled(record('a'))))).toBe(false);
    expect(await quiet(() => hung(removeInstalled('a')))).toBe(false);
  });

  it('автосейв черновика не висит и не запирает очередь записей', async () => {
    setIndexedDB(fullIndexedDB());
    const first = await quiet(() => hung(saveDraft('d1', { any: 1 })));
    expect(first).not.toBe('hung');
    expect((first as { ok: boolean }).ok).toBe(false);
    // The queue is not poisoned: a later write gets its own answer.
    setIndexedDB(fakeIndexedDB(new Map(), 2));
    const second = await quiet(() => hung(saveDraft('d2', { any: 2 })));
    expect(second).not.toBe('hung');
  });
});

describe('плагин правит штрихи: документ остаётся документом', () => {
  const tools: ToolDescriptor[] = [
    { kind: 'pencil', geometry: 'smooth', width: 8, color: '#000000' },
    { kind: 'pencil', geometry: 'cubic', width: 8, color: '#000000' },
  ];
  const cells = () => [
    { strokes: [{ points: [0, 0, 10, 10], tool_id: 0, pressure: [50, 60] }] },
    { strokes: [{ points: [0, 0, 1, 1, 2, 2, 3, 3], tool_id: 1 }, { points: [5, 5], tool_id: 0 }] },
  ];
  const valid = (strokes: ReturnType<typeof editCells>) => {
    const doc: ToonDocument = {
      schema_version: SCHEMA_VERSION,
      width: 1000,
      height: 1000,
      frame_rate: 12,
      tools,
      layers: strokes.map((cell) => ({ hidden: false, frames: [{ strokes: cell }] })),
    } as ToonDocument;
    return validateDocument(doc).issues;
  };

  it('лишнее поле плагина не попадает в документ', () => {
    const next = editCells(cells(), (strokes) => {
      for (const stroke of strokes) stroke.selected = true;
    }, tools);
    expect(valid(next)).toEqual([]);
  });

  it('выброшенный из списка штрих не роняет правку', () => {
    const next = editCells(cells(), (strokes) => {
      strokes.pop();
      strokes.pop();
    }, tools);
    expect(next[1]).toHaveLength(2);
    expect(valid(next)).toEqual([]);
  });

  it('мусор вместо точек, чужой инструмент и нажим не той длины — штрих остаётся прежним', () => {
    const next = editCells(cells(), (strokes) => {
      strokes[0].points = [1, 2, 3];
      strokes[1].points = [0, 0, 1, 1];
      strokes[2].points = 'nope' as unknown as number[];
      strokes[2].tool_id = 99;
    }, tools);
    expect(next[0][0].points).toEqual([0, 0, 10, 10]);
    // A cubic line cut to half a curve would not validate.
    expect(next[1][0].points).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(next[1][1]).toEqual({ points: [5, 5], tool_id: 0 });
    expect(valid(next)).toEqual([]);
  });

  it('новые точки при старом нажиме — нажим уходит, а не ломает документ', () => {
    const next = editCells(cells(), (strokes) => {
      strokes[0].points = [0, 0, 5, 5, 10, 10];
    }, tools);
    expect(next[0][0].points).toEqual([0, 0, 5, 5, 10, 10]);
    expect(next[0][0].pressure).toBeUndefined();
    expect(valid(next)).toEqual([]);
  });

  it('правка из окна плагина, упавшая посреди, закрывает свой жест', () => {
    const body = editorState.slice(editorState.indexOf('editPluginCells(fn'));
    expect(body.slice(0, 1600)).toMatch(/try \{[^]*editCells\(cells, fn, this\.doc\.tools\)[^]*\} finally \{\s*if \(standalone\) \{\s*this\.endPluginGesture\(\);/);
  });
});

describe('обновление плагина из каталога', () => {
  const manifest = (id: string) => ({
    default: { id, api: PLUGIN_API, tools: { [id]: { label: id, title: id, key: '', icon: '<path />' } } },
  });

  it('отвергнутая новая версия оставляет работать старую', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(record('halftone'));
    const registry = new PluginRegistry();
    const ports = {
      fetch: async (url: string) => ({ text: async () => `code:${url}` }),
      evaluate: async (code: string) =>
        code === 'old:halftone'
          ? manifest('halftone')
          : { default: { id: 'halftone', api: PLUGIN_API, tools: { halftone: { title: 'no label' } } } },
    };
    await loadInstalled(registry, ports);

    const updated = await quiet(() =>
      updateInstalled(
        [{ id: 'halftone', name: 'h', version: '2.0.0', description: '', icon: '', url: 'https://x/h.js', official: false }],
        registry,
        ports,
      ),
    );

    expect(updated).toEqual([]);
    expect(registry.tool('halftone')).toBeDefined();
    expect((await listInstalled())[0].version).toBe('1.0.0');
  });
});

describe('формат экспорта из плагина', () => {
  it('вместо файла вернул не Blob — плагин выключается, лист говорит «не вышло»', async () => {
    const registry = new PluginRegistry();
    registry.register({
      id: 'junk',
      api: PLUGIN_API,
      exporters: { junk: { label: 'Junk', run: () => ({ blob: 'not a blob', name: 'x' }) } },
    });
    const format = registry.exporters()[0];
    const failed = await quiet(() =>
      Promise.resolve(format.run({} as PluginScene, new AbortController().signal)).then(() => false, () => true),
    );
    expect(failed).toBe(true);
    expect(registry.brokenReason('junk')).toBeDefined();
  });

  it('файл без имени получает наше', async () => {
    const registry = new PluginRegistry();
    registry.register({
      id: 'noname',
      api: PLUGIN_API,
      exporters: { noname: { label: 'N', run: () => ({ blob: new Blob(['a']), name: '' }) } },
    });
    const file = await registry.exporters()[0].run({} as PluginScene, new AbortController().signal);
    expect(file.name).toBe('toonop');
  });
});

describe('.toon: огромный или подделанный файл', () => {
  const v5 = (layers: number, frames: number) => [layers, frames, 12, 999, 5, 0, 1, 1, 5, 0, 0, 0];
  const encode = (words: number[]) => new Int16Array(words).buffer as ArrayBuffer;

  it('кадров больше, чем вмещает мульт, — отказ по заголовку, без чтения кадров', () => {
    // Truncated right after the first layer's header: only an early refusal
    // can tell the frame count is the problem.
    const result = decodeToon(encode([...v5(1, MAX_FRAMES + 1), 1, 0]));
    expect(result).toEqual({ ok: false, error: t('file.over_limits') });
  });

  it('клоны кадров не раздувают точки без предела — отказ, как только точек больше лимита', () => {
    const points = 400;
    const frame0 = [0, 1, 0, points, ...Array.from({ length: points * 2 }, (_, i) => i % 100)];
    const clones = Array.from({ length: MAX_FRAMES - 1 }, () => 1);
    // Two layers promised, one written: without a running count the reader
    // copies 1.6M points first and only then trips on the missing layer.
    const result = decodeToon(encode([...v5(2, MAX_FRAMES), 1, 0, ...frame0, ...clones]));
    expect(result).toEqual({ ok: false, error: t('file.over_limits') });
  });
});

describe('Alt+L: журнал ошибок', () => {
  it('стек Firefox и Safari без сообщения — сообщение всё равно в строке', () => {
    const log = createErrorLog();
    const con = { error: (..._: unknown[]) => {} };
    log.watch({ addEventListener() {} }, con);
    const err = new Error('boom');
    err.stack = 'draw@canvas.ts:12:3\n';
    con.error(err);
    expect(log.lines[0]).toContain('boom');
    expect(log.lines[0]).toContain('draw@canvas.ts:12:3');
  });

  it('огромный объект в console.error не раздувает журнал', () => {
    const log = createErrorLog();
    const con = { error: (..._: unknown[]) => {} };
    log.watch({ addEventListener() {} }, con);
    con.error('doc:', { points: 'x'.repeat(1_000_000) });
    expect(log.lines[0].length).toBeLessThan(10_000);
  });
});

describe('экспорт', () => {
  it('GIF: второй проход ждёт воркер, а не копит все кадры в его очереди', () => {
    expect(exportGif).toMatch(/send\(\{ type: 'frame', frame \}, \[frame\.data\]\);\s*await caughtUp\(/);
  });

  it('видео не скачивается по плану для прежнего разрешения', () => {
    expect(exportSheet).toContain("(format === 'video' && (!plan || !planned))");
  });

  it('размер у границы единиц — «1 МБ», а не «1024 КБ»', () => {
    expect(formatFileSize(1024 * 1024 - 1)).toBe(`1 ${t('size.mb')}`);
    expect(formatFileSize(1023)).toBe(`1023 ${t('size.b')}`);
  });
});
