import { describe, expect, it } from 'bun:test';

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
    const keys = editorUi.slice(editorUi.indexOf('function onKeydown'), editorUi.indexOf('// Installed plugins come up'));
    expect(keys).toMatch(/case 'a':\s*case 'F7':\s*(?:\/\/.*\s*)*if \(e\.shiftKey\) \{\s*editor\.addLayerAtActive\(e\.ctrlKey \|\| e\.metaKey\);\s*\} else if \(e\.ctrlKey \|\| e\.metaKey\) \{\s*editor\.addFrameBeforeActive\(\);/);
  });
});
