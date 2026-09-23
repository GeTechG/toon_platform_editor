import { afterEach, expect, test } from 'bun:test';

import { PLUGIN_API } from '../plugins/contract';
import { plugins } from '../plugins';
import {
  allPlaced,
  defaultPanels,
  normalizePanels,
  panelItem,
  panelItems,
  slotOf,
  toolItem,
  toolOfItem,
  toolOrder,
  toolSpec,
} from './panels';
import { DEFAULT_SETTINGS, parseUiConfig, presetPanels } from './presets';
import { isHelpTool } from '../plugins';
import { TOONOP_UX } from './ux-profile';
import { t } from '../i18n';

const HALFTONE = 'a.halftone';

function install(): void {
  plugins.register({
    id: HALFTONE,
    api: PLUGIN_API,
    tools: { [HALFTONE]: { label: 'Полутон', title: 'Полутон (H)', key: 'H', icon: '<path d="M4 4h16" />' } },
  });
}

/**
 * A plugin like the one the editor ships with: a preset of somebody else's
 * editor, a brush of its own canvas and a brush type built on it.
 */
const SHIPPED = 'test.tools';
plugins.register({
  id: SHIPPED,
  api: PLUGIN_API,
  tools: {
    'test.tools.coarse': {
      label: 'Грубая', title: 'Грубая', key: '', icon: '<path />', offPanel: true,
      stroke: {
        kind: 'pencil',
        rules: () => ({ range: { min: 1, max: 300 }, capture: () => [] }),
        descriptor: ({ width, color }: { width: number; color: string }) =>
          ({ kind: 'pencil', geometry: 'smooth', width, color }),
      },
    },
  },
  presets: {
    'test.tools.bar': {
      label: 'Bar',
      brush: 'test.tools.coarse',
      brushType: 'test.tools.old',
      ux: { ...TOONOP_UX, tools: ['pencil', 'eraser', 'pipette'] },
      panels: { base: { rows: [['timeline'], ['transport'], [toolItem('pencil'), toolItem('eraser')]] } },
    },
    // The same profile without a layout of its own: it starts from the one
    // arrangement and only puts away what it does not offer.
    'test.tools.plain': {
      label: 'Plain',
      brush: 'test.tools.coarse',
      ux: { ...TOONOP_UX, tools: ['pencil', 'eraser', 'pipette'] },
    },
  },
  brushTypes: {
    'test.tools.old': { label: 'Грубая', hint: 'Линия другого холста', twins: { pencil: 'test.tools.coarse' } },
  },
});

afterEach(() => {
  plugins.remove(HALFTONE);
});

test('the built-in tools are in the register, in the order the rail draws them', () => {
  expect(toolOrder().slice(0, 3)).toEqual(['pencil', 'eraser', 'feather']);
  expect(toolSpec('pencil')?.label).toBe('Карандаш');
  expect(toolSpec('pencil')?.builtin).toBe(true);
});

test('a plugin tool becomes a panel item without a union being touched', () => {
  install();

  const item = panelItem(toolItem(HALFTONE));
  expect(item?.kind).toBe('tool');
  expect(item?.label).toBe('Полутон');
  expect(toolOfItem(toolItem(HALFTONE))).toBe(HALFTONE);
  expect(toolOrder()).toContain(HALFTONE);
});

test('a plugin tool starts on the rail, next to the tools of the editor', () => {
  install();

  expect(defaultPanels().left).toContain(toolItem(HALFTONE));
});

test("a preset hides the editor's tools it lacks, but not a stranger's plugin", () => {
  install();

  const panels = presetPanels('test.tools.plain');

  // Its profile has no feather; a plugin it "lacks" is a plugin nobody could
  // ever find, so that one stays where the arrangement put it.
  expect(panels.hidden).toContain(toolItem('feather'));
  expect(panels.hidden).not.toContain(toolItem(HALFTONE));
});

test('a preset starting from its own rows leaves anything outside them on the shelf', () => {
  install();

  // A preset that brings its own rows draws exactly those — a plugin joins
  // them the way any other key does, by being put on a panel by hand.
  expect(presetPanels('test.tools.bar').hidden).toContain(toolItem(HALFTONE));
});

test('a layout stored with a plugin that is gone loses the key, not the layout', () => {
  install();
  const stored = defaultPanels();
  expect(stored.left).toContain(toolItem(HALFTONE));
  plugins.remove(HALFTONE);

  const read = normalizePanels(stored);

  expect(allPlaced(read)).not.toContain(toolItem(HALFTONE));
  expect(read.left).toContain(toolItem('pencil'));
  expect(read.rows.flat()).toContain('timeline');
});

test('a plugin that comes back stands where its preset has it', () => {
  const without = normalizePanels(defaultPanels());
  install();

  const read = normalizePanels(without);

  expect(slotOf(read, toolItem(HALFTONE))?.slot).toBe('left');
});

test('panelItems keeps one item per id', () => {
  install();
  const ids = panelItems().map((item) => item.id);

  expect(new Set(ids).size).toBe(ids.length);
});

test('a plugin can say its tool interrupts drawing rather than replacing it', () => {
  plugins.register({
    id: 'a.ruler',
    api: PLUGIN_API,
    tools: { 'a.ruler': { label: 'Линейка', title: 'Линейка', key: '', icon: '<path d="M4 4h16" />', help: true } },
  });

  expect(isHelpTool('a.ruler')).toBe(true);
  expect(isHelpTool(HALFTONE)).toBe(false);

  plugins.remove('a.ruler');
});

const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const brushPanel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();

/** One member of the runes class, as source — the same style as undo-redo.test.ts. */
function member(source: string, name: string): string {
  const match = source.match(new RegExp(`(get )?${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

test("a tool's own window comes up with it and goes with it", () => {
  // The same place the pipette source and the zoom window live: a window that
  // arrives with its tool and leaves with it, not an item of the panels.
  expect(editorUi).toContain('editor.pluginWindow');
  // The column itself only exists while something is in it — a tool's window
  // has to be one of the things that bring it up.
  expect(editorUi).toMatch(/\{#if editor\.transform \|\| pipetteUp \|\| editor\.pluginWindow\}/);
  expect(state).toContain('closePluginWindow()');
  expect(state.slice(state.indexOf('selectTool('))).toContain('closePluginWindow()');
});

test('leaving a tool tells it so, and taking one up tells it too', () => {
  const select = state.slice(state.indexOf('selectTool('), state.indexOf('resetHelpTool'));
  expect(select).toContain('deactivate?.(');
  expect(select).toContain('activate?.(');
});

const sheet = await Bun.file(new URL('./SettingsSheet.svelte', import.meta.url)).text();

test('the address of the catalog is a setting, and it points at the build branch', () => {
  expect(DEFAULT_SETTINGS.pluginCatalog).toContain('toonop_plugins');
  const parsed = (settings: Record<string, unknown>) =>
    parseUiConfig(JSON.stringify({ preset: 'toonop', settings }))?.settings.pluginCatalog;

  expect(parsed({ pluginCatalog: 42 })).toBe(DEFAULT_SETTINGS.pluginCatalog);
  expect(parsed({ pluginCatalog: ' x ' })).toBe('x');
  // An emptied address is a choice — no catalog at all — and survives as one.
  expect(parsed({ pluginCatalog: '' })).toBe('');
  // A config written while the setting was still the register's address, whose
  // default was empty: there was no catalog to name then, so it gets ours.
  expect(parsed({ pluginRegistry: '' })).toBe(DEFAULT_SETTINGS.pluginCatalog);
  // Unless something was actually typed into it — that is an address.
  expect(parsed({ pluginRegistry: 'https://plugins.example/' })).toBe('https://plugins.example/');
});

test('the settings sheet sends you to the plugins window instead of listing plugins itself', () => {
  expect(sheet).toContain('pluginCatalog');
  expect(sheet).toContain("t('settings.plugins')");
  expect(t('settings.plugins')).toBe('Плагины');
  // What is installed, what broke and what can be installed is one list, in
  // one window; the sheet showing it too would be the same thing twice.
  expect(sheet).not.toContain('plugins.failures');
});

test('the editor starts by bringing installed plugins up from the cache', () => {
  const start = member(state, 'async startPlugins');
  expect(start).toContain('loadInstalled(');
  // The cache first, the catalog after: drawing never waits on the network.
  expect(start.indexOf('loadInstalled(')).toBeLessThan(start.indexOf('readCatalog('));
  expect(start).toContain('updateInstalled(');
  expect(state).toContain('updating = $state(false)');
  expect(editorUi).toContain('startPlugins(');
});

test('the editor is locked only while an update is actually downloading', () => {
  const start = member(state, 'async startPlugins');
  // Nothing to download, nothing to lock: the flag goes up between the
  // version check and the download, not around the check.
  expect(start.indexOf('readCatalog(')).toBeLessThan(start.indexOf('this.updating = true'));
  expect(start).toContain('finally');
  expect(start).toContain('this.updating = false');
  expect(editorUi).toContain('editor.updating');
  // A modal dialog, not a sheet of glass over the canvas: it takes the focus
  // and the keyboard with it, which a backdrop does not.
  expect(editorUi).toContain('updatingEl?.showModal()');
  expect(editorUi).toMatch(/if \(editor\.updating\) \{?\s*return/);
});

test('a preset whose plugin was not there yet comes up when it arrives', () => {
  // The choice is kept, not rewritten: an editor that opened on `toonop`
  // because a plugin had not loaded opens the way it was left once it does.
  const from = state.indexOf('refreshPlugins(): void');
  const refresh = state.slice(from, state.indexOf('\n  }', from));
  expect(refresh).toContain('presetPending');
  expect(refresh).toContain('applyPreset(this.preset, false)');
});

test('the plugin the editor ships with goes through the register like any other', async () => {
  const index = await Bun.file(new URL('../plugins/index.ts', import.meta.url)).text();
  expect(index).toContain('plugins.register(corePlugin, { bundled: true })');
  // It cannot be taken off, and the catalog has no say over it.
  expect(plugins.isBundled('core')).toBe(true);
  expect(plugins.tool('multator-pencil')).toBeDefined();
});

test('the editor reads nothing from the delivery but the line that registers it', async () => {
  // The folder travels with the editor, but it is not of it: one import in
  // one file. Anything under `lib/` reaching into it would be the parity
  // creeping back in, one convenience at a time.
  const lib = new URL('..', import.meta.url).pathname;
  const reaching: string[] = [];
  for (const file of new Bun.Glob('**/*.{ts,svelte}').scanSync({ cwd: lib })) {
    // This test names the folder to check for it; the check is about the code.
    if (file.endsWith('.test.ts')) continue;
    if ((await Bun.file(`${lib}${file}`).text()).includes('core-plugin')) {
      reaching.push(file);
    }
  }
  expect(reaching).toEqual(['plugins/index.ts']);
});

test('what the register knows reaches the rail only through the version', () => {
  const from = state.indexOf('refreshPlugins(): void');
  const refresh = state.slice(from, state.indexOf('\n  }', from));
  expect(refresh).toContain('normalizePanels(');
  expect(refresh).toContain('pluginsVersion');
  // A tool that is gone — removed, broken, refused — cannot stay in hand.
  expect(refresh).toContain("selectTool('pencil')");
});

test('a broken plugin drops out of the hand by itself', () => {
  expect(state).toContain('plugins.onBreak');
  expect(state.slice(state.indexOf('plugins.onBreak'))).toContain('refreshPlugins()');
});

test('taking a plugin off frees its storage, its key and its window', () => {
  const remove = member(state, 'async removePlugin');
  expect(remove).toContain('removeInstalled(');
  expect(remove).toContain('plugins.remove(');
  expect(remove).toContain('refreshPlugins()');
});

const toolKey = await Bun.file(new URL('./ToolKey.svelte', import.meta.url)).text();

test('a tool with no shortcut carries no data-key at all', () => {
  // The hover overlay draws `attr(data-key)` over the icon on its own
  // background. With an empty attribute it draws nothing over it — which is
  // to say it rubs the icon out (the pixel tool has had no key from the start,
  // and a plugin need not ask for one).
  expect(editorUi).toContain('.editor :global(.key[data-key]:hover:not(:disabled))::after');
  expect(toolKey).toContain('data-key={editor.keyHint(spec.key) || undefined}');
});

const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const engine = await Bun.file(new URL('../tools/profiles.ts', import.meta.url)).text();

test('the tool builds its own descriptor; the canvas only hands over the brush', () => {
  const descriptor = canvas.slice(canvas.indexOf('function activeDescriptor'), canvas.indexOf('strokeButton'));
  expect(descriptor).toContain('.descriptor({');
  // No branching over tools or over kinds: the canvas holds no table of what
  // each primitive's descriptor looks like.
  expect(descriptor).not.toContain('switch');
  expect(descriptor).not.toContain('case ');
});

test('a tool that fixes its canvas says so itself', () => {
  // The editor holds no table of which primitive belongs to which canvas: the
  // tool that lays one down names it, and a tool with no opinion draws on the
  // preset's.
  expect(plugins.probeRules('test.tools.coarse')?.range).toEqual({ min: 1, max: 300 });
  expect(plugins.tool('pencil')?.stroke?.rules).toBeUndefined();
  expect(state).toContain('plugins.probeRules(');
});

test('a grid comes with the primitive, not with a name', () => {
  expect(canvas).not.toContain("editor.tool === 'pixel'");
  expect(canvas).toContain('.stroke?.grid');
});

test('a brush that is a type of another stands on no panel', () => {
  // A twin is not a key of its own: it is what the brush in hand draws when
  // its type is picked, so no panel and no shelf offers it.
  expect(toolOrder()).not.toContain('test.tools.coarse');
  expect(panelItems().map((item) => item.id)).not.toContain(toolItem('test.tools.coarse'));
  expect(defaultPanels().hidden).not.toContain(toolItem('test.tools.coarse'));
  // Still a tool of the register, so what draws with it finds it.
  expect(plugins.probeRules('test.tools.coarse')?.range).toEqual({ min: 1, max: 300 });
});

test('the brush type is picked in the brush box, not typed as a word', () => {
  // It used to be the reference's `o`, `l`, `d` easter egg. Now the box that
  // holds thickness and smoothing holds the type as well.
  expect(editorUi).not.toContain('lastThreeKeys');
  expect(state).not.toContain('toggleOldschool');
  expect(state).not.toContain('beforeOldschool');
  expect(brushPanel).toContain("editor.brushType = ");
});

test('the type decides which brush draws, the tool in hand stays the tool', () => {
  // One resolution: the rail, the brush records and what the presets offer
  // all stay on the pencil — only the stroke comes from the old twin.
  expect(member(state, 'brushTool')).toContain('brushOfType(this.tool, this.brushType)');
  expect(canvas).toContain('toolSpec(editor.brushTool)?.stroke');
  expect(canvas).not.toContain('toolSpec(editor.tool)?.stroke');
});

test('both types of a brush share one width', () => {
  // Switching «Обычная» → «Старая» must not jump the slider or its ceiling.
  // With one canvas under every brush there is nothing to convert: the
  // record of the tool in hand is the width the stroke is laid with, and the
  // cursor ring measures the same number.
  expect(member(state, 'get brush')).toContain('brushToolOf(this.tool)');
  expect(member(state, 'get brush')).not.toContain('brushTool)');
  expect(canvas).toContain('brushWidthDoc(editor.brushSizeLogical)');
  // No normalisation at all: a pixel is a pixel, whatever the document.
  expect(canvas).not.toContain('CanvasScale');
  expect(canvas).not.toContain('documentScale');
});

test('the preset is asked about the preset, the canvas about the line', () => {
  // What is left of the old `drawingProfile` is one question: which line does
  // a brush draw that named no canvas of its own. Rasterisation, the project
  // file and the mouse-mode option are the preset's, and must not drift back.
  expect(editorUi).toContain('editor.ux.projectFile');
  expect(editorUi).not.toContain('defaultBrush');
  expect(canvas).toContain('editor.ux.canvasDensity');
  // Which brush an unopinionated tool follows is the state's question now:
  // the canvas asks for rules, never for the name of a brush.
  expect(canvas).not.toContain('editor.defaultBrush');
});

test('the stroke engine knows gestures, not tools', () => {
  // Parity with the references rests on this file, and no tool may reach it:
  // a tool that collects its own points hands over plain functions, and the
  // engine never learns whose they are.
  expect(engine).not.toContain('plugins');
  expect(engine).not.toContain('editor.tool');
  expect(engine).toContain('StrokeRules');
  // Nor any drawing application: the rules arrive as functions, unnamed.
  expect(engine.toLowerCase()).not.toContain('multator');
  expect(engine.toLowerCase()).not.toContain('toonio');
  // Not even the easter egg: what its gesture commits is the brush's rule.
  expect(engine).not.toContain('oldschool');
  expect(engine).not.toContain('Oldschool');
});

test('the types on offer come from the register, and a preset opens with its own', () => {
  // The box holds no table of types: what a tool can be switched to is
  // whatever the register knows about it, and a preset names the one it
  // opens with.
  expect(brushPanel).toContain('brushTypesFor(editor.tool)');
  expect(brushPanel).not.toContain('Мультатор');
  expect(member(state, 'applyPreset')).toContain('presetBrushType(id)');
});

test('the types are picked from a list that nothing can clip', () => {
  // Several names never fit the box's width, and the box sits in a column with
  // its own scroll — a list opened inside it would be cut off at its edge.
  expect(brushPanel).toContain('popover');
  // Hidden by the browser when closed: a layout declared unconditionally
  // would override that and leave the list on screen for good.
  expect(brushPanel).toContain(':popover-open');
  // The sample is drawn by the engine that draws the stroke, not by hand.
  expect(brushPanel).toContain('brushPreview(');
});

test('a slider that reaches nothing is not shown', () => {
  // The smoothing pair belongs to the Tonio commit: on a Multator brush, on
  // the old pen and on the pixel it would be two numbers that change nothing.
  expect(brushPanel).toContain('editor.brushSmooths');
  expect(member(state, 'brushSmooths')).toContain('brushUsesSmoothing(this.brushTool');
});

test('the box shows what the numbers do, not only the numbers', () => {
  // «Что выставить» is not answerable from two figures: the box draws the
  // brush in hand with the settings as they stand, and each slider says in
  // words which way it pulls.
  expect(brushPanel).toContain('preview(editor.brushTool)');
  expect(brushPanel).toContain("t('brush.smooth_hint')");
  expect(brushPanel).toContain("t('brush.simplify_hint')");
  expect(t('brush.smooth_hint')).toContain('отстаёт от руки');
  expect(t('brush.simplify_hint')).toContain('мелкие детали и острые углы');
  // Behind an «i», not under everyone's nose: the box is a working panel,
  // and the words come up over it when the «i» is pressed (brush-note.test.ts).
  expect(brushPanel).toContain("name=\"info\"");
  expect(brushPanel).toContain('.note.open');
});
