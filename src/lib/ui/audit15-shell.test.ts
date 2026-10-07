import { afterEach, describe, expect, it } from 'bun:test';
import { createDocument } from '../model/operations';
import { importDrafts, listDrafts } from '../draft/store';
import { parseDraft } from '../draft/restore';
import { loadDocument } from '../format/validate';
import { composing } from './key-owner';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';

// Пятнадцатый аудит, оболочка студии. Editor.svelte проверяется как исходник,
// как в audit14-shell.test.ts; что можно запустить по-настоящему — запускается.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const stateSource = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).json();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

/** Одиночная половинка суррогатной пары: такой JSON сервер (serde_json) не примет. */
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('дата черновика из чужого файла', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('за пределами календаря (1e20) становится настоящей: карточка писала «Invalid Date» и висела первой навсегда', async () => {
    setIndexedDB(fakeIndexedDB());
    const data = JSON.stringify(JSON.stringify(createDocument()));
    const raw = `{"version":1,"saves":[{"id":"far","updated":1e20,"data":${data}},{"id":"past","updated":-1e20,"data":${data}},{"id":"future","updated":253402214400000,"data":${data}}]}`;
    expect(await importDrafts(raw)).toEqual({ loaded: 3, broken: 0 });
    for (const record of await listDrafts()) {
      expect(Number.isNaN(new Date(record.updated).getTime())).toBe(false);
      expect(record.updated).toBeLessThanOrEqual(Date.now());
    }
  });
});

describe('имя слоя с половинкой эмодзи', () => {
  // Сборки до четырнадцатого аудита резали имя посреди эмодзи и так писали
  // черновик; такой .toonop или черновик открывался, а мульт не публиковался.
  const broken = () => {
    const doc = JSON.parse(JSON.stringify(createDocument()));
    doc.layers[0].name = 'Слой\uD83D';
    return doc;
  };

  it('в проекте .toonop открывается целым символом', () => {
    const doc = loadDocument(broken());
    expect(loneSurrogate.test(doc.layers[0].name ?? '')).toBe(false);
  });

  it('в черновике тоже', () => {
    const doc = parseDraft(broken());
    expect(doc).not.toBeNull();
    expect(loneSurrogate.test(doc!.layers[0].name ?? '')).toBe(false);
  });
});

describe('палитра из черновика', () => {
  it('не больше сетки: файл черновиков с сотней тысяч цветов клал их все в палитру', () => {
    // replacePalette держит предел настроек, как загрузка палитры из файла.
    const restore = stateSource.slice(stateSource.indexOf('  restoreState('), stateSource.indexOf('  resetView('));
    expect(restore).toMatch(/this\.replacePalette\(saved\.palette\)/);
  });
});

describe('набор через IME в Safari', () => {
  it('Enter, что подтверждает иероглиф, приходит с isComposing=false, но keyCode 229 — он не студии', () => {
    expect(composing({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(composing({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(composing({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it('студия и окно вкладки спрашивают именно его', () => {
    expect(fn('onKeydown')).toMatch(/if \(composing\(e\)\)/);
    expect(fn('onMoreKey')).toMatch(/!composing\(e\)/);
  });
});

describe('файл, который не читается (перемещён, удалён, не скачан из облака)', () => {
  it('брошенный файл черновиков: «не читается», а не «хранилище не приняло»', () => {
    expect(fn('openDraftsFile')).toMatch(/settings\.drafts_unreadable/);
  });

  it('проект: «не читается», а не «повреждён»', () => {
    expect(fn('openFile')).toMatch(/editor\.file_unreadable/);
    expect(ru.editor.file_unreadable).toBeString();
  });
});

describe('закрытие вкладки, пока черновик пишется', () => {
  it('спрашивает: dirty уже чистый, а запись ещё не легла', () => {
    expect(fn('saveNow')).toMatch(/writing\+\+/);
    const unload = editorUi.slice(editorUi.indexOf('onbeforeunload='), editorUi.indexOf('/>', editorUi.indexOf('onbeforeunload=')));
    expect(unload).toMatch(/writing > 0/);
  });
});

describe('«Скачать черновик» с карточки', () => {
  it('говорит об отказе, а не молчит с необработанным промисом', () => {
    const download = fn('downloadDrafts');
    expect(download).toMatch(/catch/);
    expect(download).toMatch(/settings\.drafts_save_failed/);
  });
});

describe('справка', () => {
  it('колонка клавиш по самой широкой, а не 4.6rem: «Del / Backspace» и «Ctrl+Shift+Z» рвались посреди слова', () => {
    expect(editorUi).not.toMatch(/grid-template-columns: 4\.6rem 1fr/);
    expect(editorUi).toMatch(/grid-template-columns: fit-content\(50%\) 1fr/);
    // subgrid — только Chrome 117+, цель сборки chrome111.
    expect(editorUi).not.toMatch(/grid-template-columns: subgrid/);
  });
});
