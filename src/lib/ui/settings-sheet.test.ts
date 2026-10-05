import { describe, expect, it } from 'bun:test';
import { AUTOSAVE_INTERVALS, autosaveLabel, SETTINGS_TABS, stepTab } from './presets';
import { t } from '../i18n';

// EditorState and the sheets are runes/Svelte, so they are asserted as source
// (same contract style as layers-panel.test.ts); the pure parts run for real.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const sheet = await Bun.file(new URL('./SettingsSheet.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const canvasView = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const tools = await Bun.file(new URL('./ToolKey.svelte', import.meta.url)).text();
const panels = await Bun.file(new URL('../plugins/builtins.ts', import.meta.url)).text();
const play = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();

/** The body of a class method, so a contract cannot be met by a later method. */
function methodBody(source: string, name: string): string {
  const open = source.indexOf(`${name}(`);
  const end = source.indexOf('\n  }', open);
  expect(open).toBeGreaterThan(-1);
  return source.slice(open, end);
}

/** One category's markup: from its branch to the next one. */
function pane(id: string): string {
  const open = sheet.indexOf(`tab === '${id}'}`);
  expect(open).toBeGreaterThan(-1);
  const next = sheet.indexOf("tab === '", open + 1);
  return sheet.slice(open, next === -1 ? sheet.indexOf('</dialog>') : next);
}

describe('every autosave interval the sheet offers has a label', () => {
  it('covers the list, «никогда» included', () => {
    for (const ms of AUTOSAVE_INTERVALS) {
      // A missing key comes back as the key itself, which is the failure.
      expect(autosaveLabel(ms)).not.toStartWith('autosave.');
    }
    expect(autosaveLabel(0)).toBe('никогда');
  });
});

describe('the rail and the chrome follow the reference studio', () => {
  it('drops the pipette from the rail where the profile says so', () => {
    // The rule moved into the state so the shell asks the same (19th audit).
    expect(tools).toContain('editor.pipetteOffered');
    expect(state).toContain('!this.ux.pipetteOffRail');
  });

  it('gives the rail a Справка button with no key caption', () => {
    expect(editorUi).toContain('manualOpen = true');
    expect(editorUi).toContain("aria-label={t('editor.manual')}");
    expect(t('editor.manual')).toBe('Справка');
  });

  it('opens the settings sheet straight from the gear, with no popover left', () => {
    expect(editorUi).not.toContain('settingsOpen');
    expect(editorUi).not.toContain('class="popover"');
    expect(editorUi).toMatch(/onclick=\{openSettingsSheet\}[^]{0,200}t\('editor\.settings'\)/);
    expect(t('editor.settings')).toBe('Настройки');
  });

  it('shows the fullscreen button as active while the mode is on', () => {
    expect(editorUi).toContain('isFullscreen = $state(false)');
    expect(editorUi).toContain('onfullscreenchange');
    expect(editorUi).toContain('class:active={isFullscreen}');
  });

  it('leaves fullscreen when a sheet takes the screen over', () => {
    expect(editorUi).toContain('leaveFullscreen()');
    expect(editorUi).toMatch(/function leaveFullscreen[^]{0,200}document\.exitFullscreen\(\)/);
    expect(editorUi).toMatch(/function openSettingsSheet[^]{0,120}leaveFullscreen\(\)/);
    expect(editorUi).toMatch(/async function openDrafts[^]{0,120}leaveFullscreen\(\)/);
  });

  it('puts the panels on the left under the alternative layout', () => {
    expect(editorUi).toContain('class:alt={editor.settings.altLayout}');
    expect(sheet).toContain("setSetting('altLayout'");
  });

  it('single-letter keys can be switched off from the sheet (WCAG 2.1.4)', () => {
    expect(sheet).toContain("setSetting('letterKeys'");
    expect(sheet).toContain('checked={editor.settings.letterKeys}');
  });

  it('pins every studio area to its row, so swapping the columns cannot restack them', () => {
    // Auto-placement never goes backwards: with .left at column 3 and .right
    // at column 1, an unpinned row sends each following area to a new row.
    // Every column an area claims comes with the row it claims, outside the
    // `.alt` override that only moves columns.
    const studioCss = editorUi.slice(editorUi.indexOf('.editor.studio {'));
    const claims = [...studioCss.matchAll(/grid-column: [^;]+;\s*(grid-row: [^;]+;)?/g)];
    expect(claims.length).toBeGreaterThanOrEqual(4);
    expect(claims.filter((m) => m[1] !== undefined).length).toBeGreaterThanOrEqual(4);
    // Only a wide item's span (the columns' and the small screen's column
    // keys'), the seams (a row of their own already) and the `.alt` swap
    // claim a column alone.
    expect(claims.filter((m) => m[1] === undefined)).toHaveLength(8);
  });

  it('the presets and the way into arranging sit in the view category', () => {
    expect(pane('view')).toContain("t('settings.panel')");
    expect(pane('view')).toContain('editor.applyPreset(p.id)');
    // Arranging is a gesture in the editor now — the sheet only opens it.
    expect(pane('view')).toContain('editor.arranging = true');
    expect(sheet).not.toContain('slotsOf(editor.panels)');
  });

  it('downloads the session error log on Alt+L', () => {
    expect(editorUi).toMatch(/altKey[^]{0,80}'l'/i);
    expect(editorUi).toContain('errorLog');
    // Rejections are caught by the page's one log (error-log.test.ts).
    expect(state).toContain('sessionErrors.watch(window, console)');
  });
});

describe('the settings live in the persisted UI config', () => {
  it('loads them on start and writes them back on every change', () => {
    expect(state).toContain('settings = $state<EditorSettings>');
    expect(state).toContain('this.settings = saved.settings');
    expect(state).toMatch(/setSetting[^]*?this\.persistUiConfig\(\)/);
    expect(state).toContain('settings: this.settings');
  });

  it('the mouse-mode option is the coalesced switch alone, not the old pen', () => {
    // The pen is a brush now (see plugin-tools), so the option means one thing.
    expect(state).not.toContain('get oldschool()');
    expect(state).not.toMatch(/toggleOldschool\(\)[^]*?setSetting\('mouseMode'/);
  });

  it('the transform lock the reference calls paranoid mode is that option', () => {
    expect(state).toMatch(/get transformLock\(\)[^]*?this\.settings\.lockTransform/);
  });

  it('a picked colour joins the grid only while auto-add is on', () => {
    expect(state).toMatch(/if \(!fromGrid && this\.ux\.colorGrid && this\.settings\.paletteAutoAdd\)/);
  });

  it('the grid is capped by the limit from the settings, not the constant', () => {
    expect(state).toContain('addPaletteColor(this.palette, color, this.settings.paletteLimit, this.paletteCursor)');
    expect(state).toContain('mergePalettes(this.palette, colours, this.settings.paletteLimit)');
    expect(state).not.toContain('PALETTE_LIMIT)');
  });

  it('saved palettes can leave and come back as a file, and be wiped', () => {
    expect(state).toContain('exportPalettes(');
    expect(state).toContain('importPalettes(');
    expect(state).toContain('deleteAllSavedPalettes(');
  });

  it('a full grid is overwritten in place from a cursor that a reload resets', () => {
    expect(state).toContain('paletteCursor = $state(0)');
    expect(state).toMatch(/replacePalette\([^]*?this\.paletteCursor = 0/);
  });

  it('swapping the two colours leaves an eraser for the pencil, as a pick does', () => {
    expect(methodBody(state, 'swapColors')).toMatch(/'eraser' \|\| this\.tool === 'mega-eraser'[^]*?this\.hold\('pencil'\)/);
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

  it('is split into five categories, one on screen at a time', () => {
    expect([...SETTINGS_TABS]).toEqual(['drawing', 'palette', 'view', 'saving', 'more']);
    const names = SETTINGS_TABS.map((id) => {
      expect(sheet).toContain(`t('settings.${id}')`);
      return t(`settings.${id}`);
    });
    expect(names).toEqual(['Рисование', 'Палитра', 'Вид', 'Сохранение', 'Ещё']);
    for (const id of SETTINGS_TABS) {
      expect(pane(id).length).toBeGreaterThan(0);
    }
  });

  it('every string the sheet asks for is in the dictionary', () => {
    // A key that is not there comes back as itself — and is drawn as a heading.
    const keys = [...sheet.matchAll(/t\('([a-z_]+\.[a-z_0-9]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      expect(t(key, { count: 1 })).not.toBe(key);
    }
  });

  it('an action is a row like the switches, not a pill in a heap', () => {
    // The only keys left are the close key and «Готово».
    expect(sheet.match(/class="key[ "]/g)).toHaveLength(2);
    expect(sheet).not.toContain('class="actions"');
    expect(sheet).toMatch(/\{#snippet act\(label: string, icon: IconName \| undefined, onclick: \(\) => void, danger = false\)\}/);
    // Deleting is told apart by its words' colour, and still asks first.
    expect(pane('palette')).toContain("{@render act(t('settings.wipe_palettes'), 'trash', wipePalettes, true)}");
  });

  it('the categories are tabs: one stop, arrows between them, a named panel', () => {
    expect(sheet).toContain('role="tablist"');
    expect(sheet).toContain('role="tab"');
    expect(sheet).toContain('aria-selected={tab === item.id}');
    expect(sheet).toContain('tabindex={tab === item.id ? 0 : -1}');
    expect(sheet).toMatch(/role="tabpanel"[^>]*aria-labelledby=\{`settings-tab-\$\{tab\}`\}/);
    expect(sheet).toContain('stepTab(tab, e.key)');
  });

  it('the arrows walk the categories round, Home and End jump to the ends', () => {
    expect(stepTab('drawing', 'ArrowRight')).toBe('palette');
    expect(stepTab('drawing', 'ArrowDown')).toBe('palette');
    expect(stepTab('palette', 'ArrowLeft')).toBe('drawing');
    expect(stepTab('palette', 'ArrowUp')).toBe('drawing');
    expect(stepTab('more', 'ArrowRight')).toBe('drawing');
    expect(stepTab('drawing', 'ArrowLeft')).toBe('more');
    expect(stepTab('view', 'Home')).toBe('drawing');
    expect(stepTab('view', 'End')).toBe('more');
    expect(stepTab('view', 'a')).toBeNull();
  });

  it('the sheet comes back on the category it was left on', () => {
    expect(sheet).toMatch(/<script module lang="ts">[^]*?let lastTab: SettingsTab = 'drawing'/);
    expect(sheet).toContain('let tab = $state(lastTab)');
  });

  it('every option sits in the category that names it', () => {
    const home: Record<string, string[]> = {
      drawing: ['mouseMode', 'penPressure', 'crossCursor', 'lockTransform', 'megaEraserWarning'],
      palette: ['chromePicker', 'paletteAutoAdd', 'paletteLimit'],
      view: ['altLayout', 'letterKeys'],
      saving: ['autosaveMs', 'showDraftsOnStart'],
      more: ['pluginCatalog'],
    };
    for (const [id, keys] of Object.entries(home)) {
      for (const key of keys) {
        expect(pane(id)).toContain(`setSetting('${key}'`);
      }
    }
    expect(pane('palette')).toContain('wipePalettes');
    expect(pane('saving')).toContain('saveDraftsFile');
    expect(pane('saving')).toContain('askPersist');
    expect(pane('more')).toContain('onOpenPlugins');
    expect(pane('more')).toContain('onDownloadErrors');
  });

  it('the catalog address is folded away under the plugins: nothing there for most to change', () => {
    const more = pane('more');
    // A row that names the thing, and a word on the right that opens it.
    expect(more).toMatch(/<details class="pick">\s*<summary><span>\{t\('settings\.catalog'\)\}<\/span><span class="pick-word">\{t\('settings\.change'\)\}<\/span><span class="pick-word fold">\{t\('settings\.fold'\)\}<\/span><\/summary>[^]*?setSetting\('pluginCatalog'[^]*?<\/details>/);
    expect(t('settings.change')).toBe('Изменить');
    // With the plugins it belongs to, over the error log.
    expect(more.indexOf("t('settings.catalog')")).toBeGreaterThan(more.indexOf("t('settings.open_plugins')"));
    expect(more.indexOf("t('settings.catalog')")).toBeLessThan(more.indexOf("t('settings.errors')"));
    expect(t('settings.catalog')).toBe('Каталог плагинов');
    // Open, the row says how to put it away — the word did not just vanish.
    expect(t('settings.fold')).toBe('Свернуть');
    expect(sheet).toMatch(/\.pick:not\(\[open\]\) \.fold,\s*\.pick\[open\] \.pick-word:not\(\.fold\) \{\s*display:\s*none/);
    expect(sheet).not.toMatch(/\.pick\[open\] \.pick-word \{\s*visibility/);
    // Every action row says what kind of thing it is.
    expect(pane('saving')).toContain("act(t('settings.ask_persist'), 'save', askPersist)");
    expect(t('settings.catalog_field')).toBe('Адрес каталога');
  });

  it('which drafts go into the copy is folded away: all of them, unless told', () => {
    expect(pane('saving')).toMatch(/<details[^]*?t\('settings\.drafts_chosen'[^]*?class="picklist"[^]*?<\/details>/);
    expect(t('settings.drafts_chosen', { chosen: 2, total: 3 })).toBe('В копию пойдут 2 из 3');
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
    expect(sheet).toContain("t('settings.palettes_loaded'");
    expect(t('settings.palettes_loaded', { count: 2 })).toContain('Загружено');
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

  it('«никогда» leaves the timer unarmed; leaving the studio still writes', () => {
    expect(editorUi).toMatch(/autosaveMs[^]*?=== 0/);
  });

  it('a write waits out playback and records when it happened', () => {
    expect(editorUi).toMatch(/saveNow\([^)]*\)[^]*?editor\.lastSavedAt = Date\.now\(\)/);
    // Deferred, not skipped: the transport writes it the moment it stops.
    expect(editorUi).toMatch(/if \(editor\.playing\) \{[^]*?queued = true/);
  });
});

describe('the remaining reference keys', () => {
  it('Space plays, or applies an open transform', () => {
    expect(editorUi).toMatch(/case ' ':/);
    expect(editorUi).toContain('editor.commitTransform()');
  });

  it('Ctrl+S saves the draft now, Alt+S opens the export, Alt+Enter is not a key', () => {
    expect(editorUi).toMatch(/key === 's'[^]*?saveNow\(/);
    expect(editorUi).toContain("altKey && (key === 's'");
    expect(editorUi).not.toMatch(/altKey && key === 'Enter'/);
  });

  it('the shortcut list names them too, so the sheet does not lie', () => {
    for (const combo of ['Space', 'Ctrl + S', 'Alt + S']) {
      expect(editorUi).toContain(`['${combo}'`);
    }
  });
});

describe('key hints on the buttons', () => {
  it('every tool carries its key', () => {
    expect(tools).toContain("data-key={keys.join(' / ') || undefined}");
    for (const key of ['B', 'E', 'P', 'F', 'Q', 'D']) {
      expect(panels).toContain(`key: '${key}'`);
    }
  });

  it('the transport keys are on the transport', () => {
    for (const key of ['Z', 'Y', 'K']) {
      expect(editorUi).toContain(`data-key={editor.keyHint('${key}') || undefined}`);
    }
    // The frame keys say what the frame menu says; under Multator merge names
    // none (owner-seventeenth-shell).
    for (const action of ['add', 'copy', 'paste', 'merge']) {
      expect(editorUi).toContain(`data-key={menuKey('${action}')?.label}`);
    }
    expect(play).toContain('data-key="Space"');
  });

  it('a key on a button is in its title too, for the keyboard and the readers', () => {
    expect(t('editor.onion_on')).toContain('(K)');
    expect(play).toContain('title={editor.playing');
    expect(t('play.title_play')).toContain('Space');
    expect(t('play.title_stop')).toContain('Space');
  });
});

describe('the view options', () => {
  // The dark theme belongs to the site, not to the editor: the studio carries
  // no theme of its own, no switch for one and no key.
  it('holds no theme of its own', () => {
    for (const source of [state, sheet, editorUi]) {
      expect(source.match(/class:dark|\.editor\.dark|grey-?[Cc]anvas|prefersDark|toggleTheme|Тёмная/g)).toBeNull();
    }
  });

  it('the crosshair cursor obeys both the preset and the setting', () => {
    expect(canvasView).toContain('editor.ux.crossCursor && editor.settings.crossCursor');
  });

  it('the panel says when the draft was last written, and how heavy it is', () => {
    expect(editorUi).toContain('сохранено локально');
    expect(editorUi).toContain('editor.lastSavedAt');
  });
});

describe('the browser eyedropper option', () => {
  it('is offered only where the browser has the API', () => {
    expect(sheet).toContain("'EyeDropper' in window");
    expect(sheet).toContain("editor.setSetting('chromePicker'");
  });
});

describe('«режим мышки» is the coalesced switch, and nothing else', () => {
  it('has one label, because it now means one thing', () => {
    expect(sheet).not.toContain('mouseModeLabel');
    expect(sheet).toContain("t('settings.mouse_mode')");
    expect(t('settings.mouse_mode')).toBe('Ровнее линия с мышкой');
    expect(sheet).toContain("t('settings.mouse_mode_hint')");
  });

  it('belongs to the editor, not to a brush', () => {
    // The batch is what every brush is handed, so the switch is offered
    // whatever is in hand — and the sheet names no brush to decide it.
    expect(sheet).not.toContain('defaultBrush');
  });
});

describe('the mega-eraser warns once a session', () => {
  it('keeps the flag on the session state, not in the saved settings', () => {
    expect(state).toContain('megaEraserWarned = $state(false)');
    expect(state).not.toContain("megaEraserWarned: flag");
  });

  it('warns and writes the draft the first time the tool is picked', () => {
    expect(editorUi).toContain('editor.megaEraserWarned');
    expect(editorUi).toContain('MEGA_ERASER_WARNING');
    const block = editorUi.slice(editorUi.indexOf('MEGA_ERASER_WARNING'));
    expect(block).toContain('saveNow()');
  });
});

describe('the tool rail wears one colour', () => {
  it('no tool is singled out by a colour of its own', () => {
    // The pencil used to carry the Signal Rule's red inside the rail, which
    // put one odd-coloured key among identical neighbours.
    expect(tools).not.toContain('class:draw');
    expect(editorUi).not.toContain('.key.active.draw');
  });

  it('an active key is opaque, so nothing shows through its tint', () => {
    expect(editorUi).toMatch(/\.key\.active\)\s*\{\s*background: color-mix\(in srgb, var\(--accent\) \d+%, var\(--canvas\)\)/);
  });
});
