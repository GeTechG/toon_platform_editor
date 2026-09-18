import { describe, expect, it } from 'bun:test';
import { AUTOSAVE_INTERVALS, AUTOSAVE_LABELS } from './presets';

// EditorState and the sheets are runes/Svelte, so they are asserted as source
// (same contract style as layers-panel.test.ts); the pure parts run for real.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const sheet = await Bun.file(new URL('./SettingsSheet.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const canvasView = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const tools = await Bun.file(new URL('./ToolsPanel.svelte', import.meta.url)).text();
const play = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();

describe('every autosave interval the sheet offers has a label', () => {
  it('covers the list, «никогда» included', () => {
    for (const ms of AUTOSAVE_INTERVALS) {
      expect(AUTOSAVE_LABELS[ms]).toBeString();
    }
    expect(AUTOSAVE_LABELS[0]).toBe('никогда');
    expect(Object.keys(AUTOSAVE_LABELS)).toHaveLength(AUTOSAVE_INTERVALS.length);
  });
});

describe('the settings live in the persisted UI config', () => {
  it('loads them on start and writes them back on every change', () => {
    expect(state).toContain('settings = $state<EditorSettings>');
    expect(state).toContain('this.settings = saved.settings');
    expect(state).toMatch(/setSetting[^]*?this\.persistUiConfig\(\)/);
    expect(state).toContain('settings: this.settings');
  });

  it('the «old» easter egg and the sheet toggle the one mouse-mode option', () => {
    expect(state).toMatch(/get oldschool\(\)[^]*?this\.settings\.mouseMode/);
    expect(state).toMatch(/toggleOldschool\(\)[^]*?setSetting\('mouseMode'/);
  });

  it('the transform lock the reference calls paranoid mode is that option', () => {
    expect(state).toMatch(/get transformLock\(\)[^]*?this\.settings\.lockTransform/);
  });

  it('a picked colour joins the grid only while auto-add is on', () => {
    expect(state).toMatch(/if \(!fromGrid && this\.ux\.colorGrid && this\.settings\.paletteAutoAdd\)/);
  });

  it('the grid is capped by the limit from the settings, not the constant', () => {
    expect(state).toContain('addPaletteColor(this.palette, color, this.settings.paletteLimit)');
    expect(state).toContain('mergePalettes(this.palette, colours, this.settings.paletteLimit)');
    expect(state).not.toContain('PALETTE_LIMIT)');
  });

  it('saved palettes can leave and come back as a file, and be wiped', () => {
    expect(state).toContain('exportPalettes(');
    expect(state).toContain('importPalettes(');
    expect(state).toContain('deleteAllSavedPalettes(');
  });

  it('a manual save records when it happened, for the panel to show', () => {
    expect(state).toContain('lastSavedAt = $state<number | null>(null)');
  });
});

describe('the settings sheet', () => {
  it('is a native modal dialog — Esc, the focus trap and the inert page come free', () => {
    expect(sheet).toContain('<dialog');
    expect(sheet).toContain('showModal()');
    expect(sheet).toContain('onclose={onClose}');
  });

  it('has the four reference sections', () => {
    for (const section of ['Рисование', 'Палитра', 'Автосохранение', 'Вид']) {
      expect(sheet).toContain(section);
    }
  });

  it('every drawing option writes through setSetting', () => {
    for (const key of ['mouseMode', 'crossCursor', 'lockTransform', 'paletteAutoAdd']) {
      expect(sheet).toContain(`setSetting('${key}'`);
    }
  });

  it('the palette limit is a stepped slider over the reference range', () => {
    expect(sheet).toContain('PALETTE_LIMIT_MIN');
    expect(sheet).toContain('PALETTE_LIMIT_MAX');
    expect(sheet).toContain('PALETTE_LIMIT_STEP');
  });

  it('palettes and drafts each export to a file and import back with a report', () => {
    expect(sheet).toContain('exportSavedPalettes');
    expect(sheet).toContain('importSavedPalettes');
    expect(sheet).toContain('exportDrafts');
    expect(sheet).toContain('importDrafts');
    expect(sheet).toContain('Загружено');
  });

  it('deleting every saved palette asks first', () => {
    expect(sheet).toMatch(/confirm\([^]*?deleteAllSavedPalettes/);
  });

  it('the gear popover is the way in', () => {
    expect(editorUi).toContain('SettingsSheet');
    expect(editorUi).toContain('settingsSheetOpen');
  });
});

describe('autosave on the settings interval', () => {
  it('runs on a clock, not on a trailing debounce that a drawing hand keeps resetting', () => {
    expect(editorUi).toContain('setInterval');
    expect(editorUi).not.toContain('scheduleSave');
  });

  it('«никогда» leaves the timer unarmed, so only Ctrl+S writes', () => {
    expect(editorUi).toMatch(/autosaveMs[^]*?=== 0/);
  });

  it('a write waits out playback and records when it happened', () => {
    expect(editorUi).toMatch(/saveNow\(\)[^]*?editor\.lastSavedAt = Date\.now\(\)/);
    expect(editorUi).toContain('!editor.playing');
  });
});

describe('the remaining reference keys', () => {
  it('Space plays, or applies an open transform', () => {
    expect(editorUi).toMatch(/case ' ':/);
    expect(editorUi).toContain('editor.commitTransform()');
  });

  it('Ctrl+S saves the draft now, Alt+S opens the export, Alt+Enter mutes the warnings', () => {
    expect(editorUi).toMatch(/e\.key === 's'[^]*?saveNow\(\)/);
    expect(editorUi).toContain("altKey && (e.key === 's'");
    expect(editorUi).toMatch(/altKey && e\.key === 'Enter'/);
  });

  it('N switches the theme', () => {
    expect(editorUi).toMatch(/case 'n':[^]*?toggleTheme\(\)/);
  });

  it('the shortcut list names them too, so the sheet does not lie', () => {
    for (const combo of ['Space', 'Ctrl + S', 'Alt + S', 'Alt + Enter', 'N']) {
      expect(editorUi).toContain(`['${combo}'`);
    }
  });
});

describe('key hints on the buttons', () => {
  it('every tool carries its key', () => {
    expect(tools).toContain('data-key={t.key}');
    for (const key of ['B', 'E', 'P', 'F', 'Q', 'D']) {
      expect(tools).toContain(`key: '${key}'`);
    }
  });

  it('the transport keys are on the transport', () => {
    for (const key of ['Z', 'Y', 'K', 'A', 'C', 'V', 'M']) {
      expect(editorUi).toContain(`data-key="${key}"`);
    }
    expect(play).toContain('data-key="Space"');
  });

  it('a key on a button is in its title too, for the keyboard and the readers', () => {
    expect(editorUi).toContain('Калька (K)');
    expect(play).toMatch(/title=[^]*?Space/);
  });
});

describe('the view options', () => {
  it('the dark theme is a class on the editor root, with its own tokens', () => {
    expect(editorUi).toContain('class:dark=');
    expect(editorUi).toContain('.editor.dark {');
  });

  it('the grey stage is the dark theme only, and never reaches the document', () => {
    expect(editorUi).toContain('.editor.dark.grey-canvas .stage');
    expect(editorUi).toContain('class:grey-canvas=');
  });

  it('the crosshair cursor obeys both the preset and the setting', () => {
    expect(canvasView).toContain('editor.ux.crossCursor && editor.settings.crossCursor');
  });

  it('the panel says when the draft was last written', () => {
    expect(editorUi).toContain('Сохранено');
    expect(editorUi).toContain('editor.lastSavedAt');
  });
});
