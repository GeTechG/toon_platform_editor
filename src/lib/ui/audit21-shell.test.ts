import { describe, expect, it } from 'bun:test';
import { buildKeymap, studioCommands } from './keymap';

// Двадцать первый аудит, оболочка студии. Editor.svelte проверяется как
// исходник, как в audit20-shell.test.ts.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

describe('открытый черновик сохраняется', () => {
  it('список черновиков держит документы как значения: из `$state` документ выходил прокси, и IndexedDB отказывалась его писать', () => {
    // Открыт черновик из списка → штрих → Ctrl+S: DataCloneError, «Черновик не
    // сохранился», а при уходе со страницы штрихи пропадали молча.
    expect(editorUi).toMatch(/let drafts = \$state\.raw<DraftEntry\[\]>\(\[\]\);/);
    // Значение заменяют целиком, на месте его не правят — иначе список бы не обновился.
    expect(editorUi).not.toMatch(/\bdrafts\.(push|splice|sort|reverse|pop|shift|unshift)\(|\bdrafts\[[^\]]+\]\s*=[^=]/);
  });
});

describe('перезагрузка с живой трансформацией', () => {
  it('beforeunload пишет черновик со сдвигом: запись, начатая в pagehide, в хранилище не успевает', () => {
    // Сдвиг не в документе, `flushOnLeave` писать было нечего; pagehide сдвиг
    // применял и писал, но страницы уже нет — чтение-запись IndexedDB не
    // доходит. Под вопросом браузера запись успевает лечь.
    const unload = editorUi.slice(editorUi.indexOf('onbeforeunload='), editorUi.indexOf('/>', editorUi.indexOf('onbeforeunload=')));
    expect(unload).toMatch(/const unsaved = [^;]*editor\.canUndoTransform;\s*(?:\/\/.*\s*)*flushOnHide\(\);\s*if \(unsaved\)/);
  });
});

describe('Shift+F7', () => {
  it('добавляет слой, как обещает справка: без однобуквенных клавиш строка «F7 … Shift — слой» добавляла кадр', () => {
    const keys = buildKeymap(studioCommands([]), {});
    expect(keys.resolve('F7')).toBe('add-frame');
    expect(keys.resolve('Ctrl+F7')).toBe('add-frame-before');
    expect(keys.resolve('Shift+F7')).toBe('add-layer');
    expect(keys.resolve('Ctrl+Shift+F7')).toBe('add-layer-before');
    const run = editorUi.slice(editorUi.indexOf('function runCommand'), editorUi.indexOf('// Installed plugins come up'));
    expect(run).toMatch(/case 'add-layer':\s*editor\.addLayerAtActive\(false\);/);
    expect(run).toMatch(/case 'add-layer-before':\s*editor\.addLayerAtActive\(true\);/);
    expect(run).toMatch(/case 'add-frame-before':\s*editor\.addFrameBeforeActive\(\);/);
  });
});
