import { describe, expect, it } from 'bun:test';
import { AUTOSAVE_INTERVALS, autosaveLabel } from './presets';
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
    expect(tools).toContain('editor.ux.pipetteOffRail');
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
    // Only a wide item's span, the seams (a row of their own already) and the
    // `.alt` swap claim a column alone.
    expect(claims.filter((m) => m[1] === undefined)).toHaveLength(7);
  });

  it('keeps the panel section as the last one in the settings sheet', () => {
    expect(sheet).toContain("t('settings.panel')");
    // Arranging is a gesture in the editor now — the sheet only opens it.
    expect(sheet).toContain('editor.arranging = true');
    expect(sheet).not.toContain('slotsOf(editor.panels)');
    expect(sheet.indexOf("t('settings.panel')")).toBeGreaterThan(sheet.indexOf("t('settings.view')"));
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
    expect(methodBody(state, 'swapColors')).toMatch(/'eraser' \|\| this\.tool === 'mega-eraser'[^]*?this\.tool = 'pencil'/);
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
    for (const key of ['settings.drawing', 'settings.palette', 'settings.autosave', 'settings.view']) {
      expect(sheet).toContain(`t('${key}')`);
      expect(t(key)).not.toBe(key);
    }
    expect(t('settings.drawing')).toBe('Рисование');
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
    expect(tools).toContain('data-key={editor.keyHint(spec.key) || undefined}');
    for (const key of ['B', 'E', 'P', 'F', 'Q', 'D']) {
      expect(panels).toContain(`key: '${key}'`);
    }
  });

  it('the transport keys are on the transport', () => {
    for (const key of ['Z', 'Y', 'K', 'A', 'C', 'V', 'M']) {
      expect(editorUi).toContain(`data-key={editor.keyHint('${key}') || undefined}`);
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
