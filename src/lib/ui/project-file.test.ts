import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

// Editor.svelte and the sheets are Svelte, so they are asserted as source —
// the same contract style as editor-keys.test.ts. The logic they call into
// (decoders, the draft store, `isEmptyDocument`, `formatFileSize`) is tested
// for real in its own module.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const sheet = await Bun.file(new URL('./SettingsSheet.svelte', import.meta.url)).text();
const play = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();

describe('Alt+S saves the project as a file', () => {
  it('writes the document itself, under the .toonop name', () => {
    expect(editorUi).toContain('function saveProjectFile()');
    expect(editorUi).toContain("t('editor.download_project_confirm')");
    expect(t('editor.download_project_confirm')).toBe('Скачать проект в формате .toonop?');
    expect(editorUi).toContain("type: 'application/json'");
    expect(editorUi).toContain("'toonop.toonop'");
    expect(editorUi).toContain('JSON.stringify(editor.doc)');
  });

  it('asks unless the warnings are muted', () => {
    expect(editorUi).toMatch(/saveProjectFile\(\)[^]*?editor\.warnings/);
  });

  it('is the export everywhere but in the Toonio preset', () => {
    expect(editorUi).toMatch(/altKey && \(key === 's'[^]*?hasProjectFile[^]*?exportButton\?\.start\(\)/);
  });

  it('the shortcut table says what the key does in this preset', () => {
    expect(editorUi).toContain("['Alt + S', hasProjectFile ? t('key.download_project') : t('key.export')]");
    expect(t('key.download_project')).toBe('Скачать проект (.toonop)');
    expect(t('key.export')).toBe('Экспорт');
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
    expect(editorUi).toMatch(/importError = t\('editor\.file_failed'[^]*?return;/);
    expect(t('editor.file_failed', { reason: 'x' })).toStartWith('Не удалось открыть файл');
  });
});

describe('a file dropped on the window', () => {
  it('opens a drawing, attaches a sound and names anything else', () => {
    expect(editorUi).toContain('ondrop={onDrop}');
    expect(editorUi).toContain('function onDrop(');
    expect(editorUi).toContain("type.startsWith('audio/')");
    expect(editorUi).toContain("t('editor.file_unsupported')");
    expect(t('editor.file_unsupported')).toContain('.toonop');
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
    expect(editorUi).toContain('let draftId = $state(newDraftId());');
    expect(editorUi).not.toContain('draftId ??= newDraftId()');
    // Still nothing written until something is drawn.
    expect(editorUi).toMatch(/function saveNow\([^)]*\)[^]*?if \(!editor\.touched/);
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
    // The document is a value the editor holds whole: it goes to storage as it
    // is, with no snapshot taken and no second pass to size it.
    expect(editorUi).toContain('const doc = editor.doc;');
    expect(editorUi).not.toContain('JSON.stringify(doc).length');
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
    expect(editorUi).toContain("t('editor.save_failed')");
    expect(t('editor.save_failed')).toBe('Ошибка локального сохранения');
    expect(editorUi).toContain('saveFailed = true');
    expect(editorUi).toMatch(/saveFailed[^]*?clearInterval|clearInterval[^]*?saveFailed/);
  });

  // The clock stops after a failure, and the hand was stopped with it: the
  // key, Ctrl+S and the sheet all returned early, and the alert sent the user
  // to reload — the one step that loses a drawing nothing has kept.
  it('a save asked for by hand tries again, and one that lands clears the failure', () => {
    expect(editorUi).toMatch(/function saveNow\(byHand = false\)[^]*?saveFailed && !byHand/);
    expect(editorUi).toMatch(/if \(ok\) \{[^}]*saveFailed = false/);
    // The failed record is still unsaved, so the key stays pressable.
    expect(editorUi).toMatch(/saveFailed = true;\s*dirty = true;/);
    expect(editorUi).toContain('onclick={() => saveNow(true)}');
    expect(editorUi).toContain('onSaveNow={() => saveNow(true)}');
    expect(editorUi).toMatch(/metaKey\) && \(key === 's'[^]*?saveNow\(true\)/);
    expect(t('editor.save_failed_alert')).not.toContain('перезагруз');
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
    expect(sheet).toContain("t('settings.ask_persist')");
    expect(t('settings.ask_persist')).toBe('Запросить постоянное хранилище');
    expect(sheet).toContain("t('settings.save_now')");
    expect(t('settings.save_now')).toStartWith('Сохранить сейчас');
  });

  it('the Toonio rail has a save key, dimmed while there is nothing to save', () => {
    expect(editorUi).toContain('onclick={() => saveNow(true)}');
    expect(editorUi).toContain('disabled={!dirty}');
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

  it('hands one record to the browser as a file, without asking', () => {
    expect(editorUi).toContain('async function downloadDraft(entry: DraftEntry)');
    expect(editorUi).toContain('exportDrafts([entry.id])');
    expect(editorUi).toContain("'draft.toonops'");
    expect(editorUi).toContain('onclick={() => downloadDraft(entry)}');
    expect(editorUi).toContain("t('editor.draft_download_title')");
    expect(t('editor.draft_download')).toBe('Скачать черновик');
  });

  it('copies, deletes one and deletes all', () => {
    expect(editorUi).toContain('duplicateDraft(');
    expect(editorUi).toContain('deleteAllDrafts()');
    expect(editorUi).toContain("t('editor.drafts_wipe_confirm')");
    expect(t('editor.drafts_wipe_confirm')).toStartWith('Удалить все черновики?');
  });

  // The pressed key went with its row and the focus fell to the page under a
  // modal sheet: the next Tab started again from the top of the sheet.
  it('a delete leaves the focus on the row that took its place, or on «Закрыть»', () => {
    expect(editorUi).toMatch(/async function removeDraft[^]*?refocusDrafts\(at\)/);
    expect(editorUi).toMatch(/async function removeAllDrafts[^]*?refocusDrafts\(0\)/);
    expect(editorUi).toMatch(/function refocusDrafts[^]*?await tick\(\)[^]*?\.draft-open[^]*?\.sheet-foot \.primary/);
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
    expect(sheet).toContain("t('settings.drafts_loaded', { loaded, broken })");
    expect(t('settings.drafts_loaded', { loaded: 3, broken: 1 })).toBe('Загружено 3, повреждено 1');
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
