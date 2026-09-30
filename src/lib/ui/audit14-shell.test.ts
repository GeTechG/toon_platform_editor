import { afterEach, describe, expect, it, mock } from 'bun:test';
import { createDocument, renameLayer } from '../model/operations';
import { importDrafts, listDrafts, newDraftId } from '../draft/store';
import { decodeLegacyJson, decodeToon } from '../format/toon-decode';
import { createErrorLog } from './error-log';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';

// Четырнадцатый аудит, оболочка студии. Editor.svelte проверяется как исходник,
// как в audit13-shell.test.ts; что можно запустить по-настоящему — запускается.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

/** Одиночная половинка суррогатной пары: такой JSON сервер (serde_json) не примет. */
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('id черновика вне защищённого контекста', () => {
  const original = crypto.randomUUID;
  afterEach(() => {
    (crypto as { randomUUID?: unknown }).randomUUID = original;
  });

  it('выдаётся и без crypto.randomUUID: студия по http с адреса в сети не падала бы на старте', () => {
    // randomUUID есть только в защищённом контексте: открытая с телефона по
    // http://192.168.… студия бросала TypeError ещё до первого кадра.
    (crypto as { randomUUID?: unknown }).randomUUID = undefined;
    const a = newDraftId();
    const b = newDraftId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('файл черновиков из чужих рук', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });
  const data = JSON.stringify(createDocument());

  it('с бесконечной датой получает настоящую: список сортировался NaN-ом, карточка писала «Invalid Date»', async () => {
    setIndexedDB(fakeIndexedDB());
    const raw = `{"version":1,"saves":[{"id":"x","updated":1e999,"data":${JSON.stringify(data)}}]}`;
    const before = Date.now();
    expect(await importDrafts(raw)).toEqual({ loaded: 1, broken: 0 });
    const [record] = await listDrafts();
    expect(Number.isFinite(record.updated)).toBe(true);
    expect(record.updated).toBeGreaterThanOrEqual(before);
  });

  it('оставляет руку, в которой кисть не рисует: толщина 0, шаг точек в миллион', async () => {
    setIndexedDB(fakeIndexedDB());
    const state = (patch: Record<string, unknown>) => ({
      frame: 0,
      layer: 0,
      tool: 'pencil',
      widths: { pencil: 4 },
      smooth: { pencil: 3 },
      minDistance: { pencil: 3 },
      outline: '#000000',
      fill: '#ff0000',
      palette: ['#000000'],
      ...patch,
    });
    const raw = JSON.stringify({
      version: 1,
      saves: [
        { id: 'ok', updated: 1, data, state: state({}) },
        { id: 'thin', updated: 2, data, state: state({ widths: { pencil: 0 } }) },
        { id: 'far', updated: 3, data, state: state({ minDistance: { pencil: 1e6 } }) },
        { id: 'rough', updated: 4, data, state: state({ smooth: { pencil: -5 } }) },
      ],
    });
    await importDrafts(raw);
    const byId = Object.fromEntries((await listDrafts()).map((d) => [d.id, d]));
    expect(byId.ok.state).toBeDefined();
    expect(byId.thin.state).toBeUndefined();
    expect(byId.far.state).toBeUndefined();
    expect(byId.rough.state).toBeUndefined();
  });
});

describe('старое сохранение Тунио в .json', () => {
  it('с дробными точками открывается: мышь давала 10.33, а файл отказывался «больше кадров, чем вмещает мульт»', () => {
    const result = decodeLegacyJson(JSON.stringify({
      Data: { FPS: 12 },
      Frames: [[{ Width: 5.3, Color: '#ff0000', Cs: [{ x: 10.33, y: 20.1 }, { x: 30.7, y: 40.25 }] }]],
    }));
    expect(result.ok).toBe(true);
  });
});

describe('имя слоя', () => {
  it('обрезается по символу, а не посреди эмодзи', () => {
    const doc = createDocument();
    renameLayer(doc, 0, 'ааааааааааа😀');
    expect(doc.layers[0].name).toBe('ааааааааааа');
    expect(loneSurrogate.test(doc.layers[0].name ?? '')).toBe(false);
  });

  it('из .toon тоже', () => {
    const name = 'ааааааааааа😀';
    // Слоёв 1, кадров 1, 12 к/с, подпись 999, версия 2; видимый слой, имя, линий 0.
    const units = [1, 1, 12, 999, 2, 1, name.length];
    for (let i = 0; i < name.length; i++) units.push(name.charCodeAt(i));
    units.push(0);
    const result = decodeToon(new Int16Array(units).buffer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(loneSurrogate.test(result.doc.layers[0].name ?? '')).toBe(false);
    }
  });
});

describe('журнал ошибок', () => {
  it('не роняет console.error на объекте, который не пишется ни JSON-ом, ни строкой', () => {
    const log = createErrorLog();
    const shown = mock(() => {});
    const con = { error: shown as (...args: unknown[]) => void };
    log.watch({ addEventListener() {} }, con);
    const odd = Object.create(null) as Record<string, unknown>;
    odd.self = odd;
    expect(() => con.error('сбой', odd)).not.toThrow();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(log.lines.length).toBe(1);
  });
});

describe('заметка об отказе броска', () => {
  it('не ломает студию там, где нет popover (Safari 16 на iPhone 8/X, Firefox ESR 115)', () => {
    // `matches(':popover-open')` бросает SyntaxError в эффекте при монтировании.
    const effect = editorUi.slice(editorUi.indexOf('const el = dropNoteEl;') - 200, editorUi.indexOf('function onDragOver'));
    expect(effect).toMatch(/if \(!popovers\)/);
    // Атрибут, которого браузер не знает, он просто пропускает.
    expect(editorUi).toMatch(/<p[^>]*popover="manual"[^>]*role="status"/);
    // Видна по своему классу, а не по псевдоклассу, которого браузер не знает:
    // иначе правило выпадает целиком и пустая рамка висит внизу всегда.
    expect(editorUi).not.toMatch(/\.drop-note:not\(:popover-open\)/);
    expect(editorUi).toMatch(/\.drop-note:not\(\.shown\)/);
  });
});

describe('уход из студии с живой трансформацией', () => {
  it('пишет черновик, хотя часы только что записали: dirty ставит эффект, а он после onDestroy', () => {
    const leave = fn('flushOnLeave');
    expect(leave).toMatch(/editor\.doc !== writtenDoc/);
    expect(fn('saveNow')).toMatch(/writtenDoc = doc;/);
  });

  it('закрытие вкладки спрашивает, пока выделение сдвинуто и не применено', () => {
    const unload = editorUi.slice(editorUi.indexOf('onbeforeunload='), editorUi.indexOf('/>', editorUi.indexOf('onbeforeunload=')));
    expect(unload).toMatch(/\|\| editor\.canUndoTransform;/);
  });

  it('уход страницы (pagehide — Safari на iOS не шлёт beforeunload) применяет сдвиг и пишет', () => {
    expect(editorUi).toMatch(/onpagehide=\{[^}]*editor\.leaveTransform\(\);\s*flushOnLeave\(\)/);
  });
});

describe('открытие файла или черновика поверх живой трансформации', () => {
  it('сначала применяет сдвиг: он не терялся ни в старом рисунке, ни в новом', () => {
    for (const name of ['openFile', 'openDraft']) {
      const body = fn(name);
      const leave = body.indexOf('if (!editor.leaveTransform()) {');
      expect(leave).toBeGreaterThan(-1);
      expect(leave).toBeLessThan(body.indexOf('saveNow(true)'));
    }
  });

  it('копия и «Скачать» из черновиков и настроек берут рисунок с применённым сдвигом', () => {
    for (const name of ['openDrafts', 'openSettingsSheet']) {
      // Эффект, что ставит dirty, придёт позже: применённый сдвиг отмечается здесь.
      expect(fn(name)).toMatch(/editor\.leaveTransform\(\);[^]*editor\.doc !== writtenDoc\) \{\s*dirty = true;[^]*saveNow\(\)/);
    }
  });
});

describe('черновики на старте', () => {
  it('не выскакивают поверх того, что уже начали: список читается долго, а рука рисует', () => {
    const mount = editorUi.slice(editorUi.indexOf('editor.ask = (message'), editorUi.indexOf('async function openDrafts'));
    expect(mount).toMatch(/draftsOpen = drafts\.length > 0 && editor\.settings\.showDraftsOnStart && !editor\.touched && !sheetOpen\(\)/);
  });

  it('список, дочитанный после ухода, не оставляет ссылок на картинки', () => {
    expect(fn('refreshDrafts')).toMatch(/if \(destroyed\) \{\s*return;\s*\}/);
  });
});

describe('мануал', () => {
  it('не обещает F — во весь экран там, где его нет (iPhone): кнопки тоже нет', () => {
    const rows = editorUi.slice(editorUi.indexOf('const SHORTCUTS'), editorUi.indexOf('.filter((row)'));
    expect(rows).toMatch(/\(hasFeather \|\| document\.fullscreenEnabled\) && \['F'/);
  });
});

describe('проект новой версии', () => {
  it('называется новой версией, а не «повреждён или не проект toonop»', () => {
    expect(fn('openFile')).toMatch(/unsupported-version[^]*file\.version_unsupported/);
  });
});

describe('набор через IME (японский, китайский, корейский)', () => {
  it('Enter, что выбирает иероглиф, и Esc, что отменяет набор, — не клавиши студии', () => {
    // Enter в имени слоя применял живую трансформацию, Esc закрывал окно вкладки
    // вместе с полем, в котором ещё шёл набор.
    const keys = fn('onKeydown');
    const guard = keys.indexOf('if (composing(e)) {');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(keys.indexOf("key === 'Escape'"));
    expect(fn('onTabWindowKey')).toMatch(/!composing\(e\)/);
  });
});

describe('проект файлом (Alt+S в пресете Тунио)', () => {
  it('уходит с применённым сдвигом, как публикация и экспорт', () => {
    const body = fn('saveProjectFile');
    const leave = body.indexOf('if (!editor.leaveTransform()) {');
    expect(leave).toBeGreaterThan(-1);
    expect(leave).toBeLessThan(body.indexOf('JSON.stringify(editor.doc)'));
  });
});
