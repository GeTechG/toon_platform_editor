import { describe, expect, it } from 'bun:test';

// Editor.svelte and the sheets are Svelte, so they are asserted as source —
// the same contract style as editor-keys.test.ts. The logic they call into
// (decoders, the draft store, `isEmptyDocument`, `formatFileSize`) is tested
// for real in its own module.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const sheet = await Bun.file(new URL('./SettingsSheet.svelte', import.meta.url)).text();
const tools = await Bun.file(new URL('./ToolsPanel.svelte', import.meta.url)).text();
const play = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();

describe('Alt+S saves the project as a file', () => {
  it('writes the document itself, under the .toonop name', () => {
    expect(editorUi).toContain('function saveProjectFile()');
    expect(editorUi).toContain('Скачать проект в формате .toonop?');
    expect(editorUi).toContain("type: 'application/json'");
    expect(editorUi).toContain("'toonop.toonop'");
    expect(editorUi).toContain('JSON.stringify($state.snapshot(editor.doc))');
  });

  it('asks unless the warnings are muted', () => {
    expect(editorUi).toMatch(/saveProjectFile\(\)[^]*?editor\.warnings/);
  });

  it('is the export everywhere but in the Toonio preset', () => {
    expect(editorUi).toMatch(/altKey && \(e\.key === 's'[^]*?studio[^]*?exportButton\?\.start\(\)/);
  });

  it('the shortcut table says what the key does in this preset', () => {
    expect(editorUi).toContain("['Alt + S', studio ? 'Скачать проект (.toonop)' : 'Экспорт']");
  });
});

describe('one door for every file the editor opens', () => {
  it('picks the decoder by extension', () => {
    expect(editorUi).toContain('async function openFile(file: File)');
    expect(editorUi).toContain("name.endsWith('.toonop')");
    expect(editorUi).toContain("name.endsWith('.toon')");
    expect(editorUi).toContain("name.endsWith('.json')");
    expect(editorUi).toContain('loadDocument(JSON.parse(');
    expect(editorUi).toContain('decodeToon(');
    expect(editorUi).toContain('decodeLegacyJson(');
  });

  it('offers all three in the dialog', () => {
    expect(editorUi).toContain('accept=".toonop,.toon,.json"');
  });

  it('writes the draft before it replaces the drawing, and says why it could not open one', () => {
    expect(editorUi).toMatch(/openFile[^]*?editor\.touched[^]*?saveNow\(\)/);
    expect(editorUi).toContain('importError = ');
  });

  it('the drawing that could not be read leaves the current one alone', () => {
    // `importDoc` is reached only after every decoder has succeeded.
    expect(editorUi).toMatch(/importError = `Не удалось открыть файл[^]*?return;/);
  });
});

describe('a file dropped on the window', () => {
  it('opens a drawing, attaches a sound and names anything else', () => {
    expect(editorUi).toContain('ondrop={onDrop}');
    expect(editorUi).toContain('function onDrop(');
    expect(editorUi).toContain("type.startsWith('audio/')");
    expect(editorUi).toContain('Кажется, такой формат файла не поддерживается');
  });
});

describe('opening a file takes the palette and drops the track', () => {
  it('steals the colours of the drawing and clears the sound', () => {
    expect(editorUi).toMatch(/importDoc\([^]*?\n(.|\n)*?editor\.audio\.clear\(\)/);
    expect(state).toContain('stealPalette(');
    expect(editorUi).toContain('editor.stealPalette(');
  });

  it('starts a new draft record, so the file does not overwrite the visit', () => {
    expect(editorUi).toMatch(/importDoc\([^]*?draftId = newDraftId\(\)/);
  });

  it('keeps the title the .toon carried', () => {
    expect(state).toContain('original = $state');
    expect(editorUi).toContain('editor.original =');
  });
});

describe('the autosave record is one per visit', () => {
  it('mints the id when the editor opens, not on the first change', () => {
    expect(editorUi).toContain('let draftId = newDraftId();');
    expect(editorUi).not.toContain('draftId ??= newDraftId()');
    // Still nothing written until something is drawn.
    expect(editorUi).toMatch(/function saveNow\(\)[^]*?if \(!editor\.touched/);
  });

  it('a write deferred by playback happens the moment playback stops', () => {
    expect(editorUi).toContain('queued = true');
    expect(editorUi).toContain('export function saveQueued()');
    expect(play).toContain('editor.onStop?.()');
  });

  it('forces a write before an export, a mega eraser and any file opening', () => {
    expect(editorUi).toMatch(/onOpen=\{\(\) => \{[^]{0,120}saveNow\(\)/);
    expect(editorUi).toMatch(/megaEraserWarned = true;[^]*?saveNow\(\)/);
    expect(editorUi).toMatch(/function openDraft[^]*?saveNow\(\)/);
  });
});

describe('what the record holds and what comes back', () => {
  it('writes the hand along with the drawing', () => {
    expect(editorUi).toContain('saveDraft(draftId, doc, editor.sessionState())');
    expect(editorUi).toContain('$state.snapshot(editor.doc)');
    expect(state).toContain('sessionState(): DraftState');
    expect(state).toContain('restoreState(');
  });

  it('draws the card thumbnail when the CPU is idle, not mid-stroke', () => {
    expect(editorUi).toContain('requestIdleCallback');
    expect(editorUi).toContain('setDraftScreenshot(');
  });

  it('puts the hand back when the draft is opened, and copes without a state', () => {
    expect(editorUi).toContain('editor.restoreState(entry.state)');
    expect(editorUi).toContain('if (entry.state)');
  });
});

describe('a failed write is not silent', () => {
  it('says so, marks the indicator and stops trying until the page reloads', () => {
    expect(editorUi).toContain('Ошибка локального сохранения');
    expect(editorUi).toContain('saveFailed = true');
    expect(editorUi).toMatch(/saveFailed[^]*?clearInterval|clearInterval[^]*?saveFailed/);
  });
});

describe('the indicator', () => {
  it('names the storage, the date and the weight', () => {
    expect(editorUi).toContain('сохранено локально');
    expect(editorUi).toContain('formatFileSize(');
    expect(editorUi).toContain('draftSizeClass(');
  });
});

describe('persistent storage', () => {
  it('is asked for on the way in, and can be asked for again', () => {
    expect(editorUi).toContain('navigator.storage');
    expect(editorUi).toContain('.persist?.()');
    expect(sheet).toContain('Запросить постоянное хранилище');
    expect(sheet).toContain('Сохранить сейчас');
  });

  it('the Toonio rail has a save key, dimmed while there is nothing to save', () => {
    expect(tools).toContain('onSave');
    expect(tools).toContain('disabled={!dirty}');
    expect(editorUi).toContain('dirty');
  });
});

describe('the drafts list', () => {
  it('shows the screenshot, the track and the weight of every record', () => {
    expect(editorUi).toContain('entry.screenshot');
    expect(editorUi).toContain('entry.audio');
    expect(editorUi).toContain('formatFileSize(entry.bytes');
    expect(editorUi).toContain('navigator.storage?.estimate');
  });

  it('copies, deletes one and deletes all', () => {
    expect(editorUi).toContain('duplicateDraft(');
    expect(editorUi).toContain('deleteAllDrafts()');
    expect(editorUi).toContain('Удалить все черновики?');
  });
});

describe('the drafts file', () => {
  it('exports what is ticked, with a progress bar, and reports what came back', () => {
    expect(sheet).toContain('exportDrafts(');
    expect(sheet).toContain('importDrafts(');
    expect(sheet).toContain('<progress');
    expect(sheet).toContain('type="checkbox"');
    // Our own name for our own file; `.toonio` stays readable, not writable.
    expect(sheet).toContain("'drafts.toonops'");
    expect(sheet).toContain('.toonops,.toonio');
    expect(sheet).toContain('Загружено ${loaded}, повреждено ${broken}');
  });
});

describe('the picklist in the settings cannot show a record that is not a draft', () => {
  it('goes through draftEntries, so a document-less record never appears', () => {
    // A write that landed after a delete used to recreate the record as a
    // stub: gone from the drafts sheet, still ticked here, and exported as
    // `"data":"null"`. The list is built from parsed entries now.
    expect(sheet).toContain('draftEntries(');
    expect(sheet).not.toContain('drafts = records');
  });

  it('names what each record holds, not just its date', () => {
    expect(sheet).toContain('formatFileSize(');
  });
});

describe('leaving the page with unsaved work', () => {
  it('asks, unless the sheet is empty or everything is written', () => {
    expect(editorUi).toContain('onbeforeunload');
    expect(editorUi).toContain('isEmptyDocument(editor.doc)');
    expect(editorUi).toMatch(/onbeforeunload[^]*?dirty/);
  });
});
