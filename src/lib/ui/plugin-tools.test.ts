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
import { isHelpTool } from './ux-profile';

const HALFTONE = 'a.halftone';

function install(): void {
  plugins.register({
    id: HALFTONE,
    api: PLUGIN_API,
    tool: { label: 'Полутон', title: 'Полутон (H)', key: 'H', icon: '<path d="M4 4h16" />' },
  });
}

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

test('a parity profile hides the tools its reference lacks, but not a plugin', () => {
  install();

  const panels = presetPanels('toonio');

  // tools.js has no pixel button; the reference knows nothing of plugins, so a
  // plugin it "lacks" is a plugin nobody could ever find.
  expect(panels.hidden).toContain(toolItem('pixel'));
  expect(panels.hidden).not.toContain(toolItem(HALFTONE));
});

test('Multator starts from its own rows, so anything outside them waits on the shelf', () => {
  install();

  // The reference draws one fixed toolbar and nothing else — a plugin joins it
  // the way any other key does, by being put on a panel by hand.
  expect(presetPanels('multator').hidden).toContain(toolItem(HALFTONE));
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
    tool: { label: 'Линейка', title: 'Линейка', key: '', icon: '<path d="M4 4h16" />', help: true },
  });

  expect(isHelpTool('a.ruler')).toBe(true);
  expect(isHelpTool(HALFTONE)).toBe(false);

  plugins.remove('a.ruler');
});

const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

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

test('the address of the register is a setting, empty until someone types one', () => {
  expect(DEFAULT_SETTINGS.pluginRegistry).toBe('');
  expect(parseUiConfig(JSON.stringify({ preset: 'toonop', settings: { pluginRegistry: 42 } }))?.settings.pluginRegistry).toBe('');
  expect(parseUiConfig(JSON.stringify({ preset: 'toonop', settings: { pluginRegistry: ' x ' } }))?.settings.pluginRegistry).toBe('x');
});

test('the sheet shows the address and what came of it', () => {
  expect(sheet).toContain('pluginRegistry');
  expect(sheet).toContain('plugins.failures');
});

test('changing the address rereads the register, without a reload', () => {
  expect(editorUi).toContain('editor.settings.pluginRegistry');
  expect(editorUi).toContain('reloadPlugins(');
  const reload = state.slice(state.indexOf('async reloadPlugins('));
  expect(reload).toContain('resetExternal()');
  // The register is plain data, outside the runes: what was loaded reaches the
  // rail and the settings list only if the state says something changed.
  expect(reload).toContain('normalizePanels(');
  expect(reload).toContain('pluginsVersion');
});

const toolKey = await Bun.file(new URL('./ToolKey.svelte', import.meta.url)).text();

test('a tool with no shortcut carries no data-key at all', () => {
  // The hover overlay draws `attr(data-key)` over the icon on its own
  // background. With an empty attribute it draws nothing over it — which is
  // to say it rubs the icon out (the pixel tool has had no key from the start,
  // and a plugin need not ask for one).
  expect(editorUi).toContain('.editor :global(.key[data-key]:hover:not(:disabled))::after');
  expect(toolKey).toContain('data-key={spec.key || undefined}');
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
  expect(plugins.tool('pixel')?.stroke?.dialect).toBe('toonio');
  expect(plugins.tool('pencil')?.stroke?.dialect).toBeUndefined();
  expect(canvas).toContain('?.stroke?.dialect ?? editor.defaultDialect');
});

test('a grid comes with the primitive, not with a name', () => {
  expect(canvas).not.toContain("editor.tool === 'pixel'");
  expect(canvas).toContain('.stroke?.grid');
});

test('a brush reached only by a gesture stands on no panel', () => {
  // The oldschool pen is an easter egg: it is in the register like any brush,
  // but the arrangement never offers it — the keys `o`, `l`, `d` do.
  expect(toolOrder()).not.toContain('oldschool');
  expect(panelItems().map((item) => item.id)).not.toContain(toolItem('oldschool'));
  expect(defaultPanels().hidden).not.toContain(toolItem('oldschool'));
  // Still a tool of the register, so what takes it in hand finds it.
  expect(toolSpec('oldschool')?.stroke?.dialect).toBe('multator');
});

test('the «old» easter egg takes the brush in hand and gives the last one back', () => {
  // It used to set a flag the engine read on every commit. Now it is what any
  // other tool key is: a selection, and the way back when typed again.
  expect(state).toMatch(/toggleOldschool\(\)[^]*?oldschoolSwap\([^]*?selectTool\(/);
  expect(editorUi).toContain("lastThreeKeys.join('') === 'old'");
  // The `d` that finishes the word is the word's, not the hand's — or the egg
  // would hand over the brush and take it away in the same keystroke.
  expect(editorUi).toMatch(/=== 'old'\) \{[^}]*?toggleOldschool\(\);[^}]*?return;/);
  // Picking any other brush by hand closes the egg's memory, or typing the
  // word again would give back what it took instead of taking the twin of
  // what is in hand now. A help tool (the hand `o` selects on the way) does
  // not count as picking one.
  expect(member(state, 'selectTool')).toMatch(/isHelpTool\(resolved\)[^]*?beforeOldschool = null/);
});

test('the preset is asked about the preset, the canvas about the line', () => {
  // What is left of the old `drawingProfile` is one question: which line does
  // a brush draw that named no canvas of its own. Rasterisation, the project
  // file and the mouse-mode option are the preset's, and must not drift back.
  expect(editorUi).toContain('editor.ux.projectFile');
  expect(editorUi).not.toContain('defaultDialect');
  expect(canvas).toContain('editor.ux.canvasDensity');
  expect(canvas.match(/editor\.defaultDialect/g)).toHaveLength(1);
});

test('the stroke engine knows gestures, not tools', () => {
  // Parity with the references rests on this file, and no tool may reach it:
  // a tool that collects its own points hands over plain functions, and the
  // engine never learns whose they are.
  expect(engine).not.toContain('plugins');
  expect(engine).not.toContain('editor.tool');
  expect(engine).toContain('OwnCapture');
  // Not even the easter egg: what its gesture commits is the brush's rule.
  expect(engine).not.toContain('oldschool');
  expect(engine).not.toContain('Oldschool');
});
