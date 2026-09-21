import { expect, test } from 'bun:test';
import {
  BRUSH_TOOLS,
  brushToolOf,
  brushUsesSmoothing,
  DEFAULT_DRAWING_UI_CONFIG,
  AUTOSAVE_INTERVALS,
  DEFAULT_PRESET,
  DEFAULT_SETTINGS,
  defaultBrushOf,
  presets,
  parseUiConfig,
  PANEL_HEIGHT_MAX,
  PANEL_HEIGHT_MIN,
  SIDE_WIDTH_MAX,
  SIDE_WIDTH_MIN,
  PALETTE_LIMIT_MAX,
  PALETTE_LIMIT_MIN,
  presetBrushType,
  presetDefaultBrush,
  presetUx,
} from './presets';
import { defaultPanels, movePanelItem } from './panels';
import { TOONOP_UX } from './ux-profile';
import { copyBrushes } from './presets';
import { plugins } from '../plugins';
import { PLUGIN_API } from '../plugins/contract';

/** The editor's own brush and a plugin's, with numbers of its own. */
const OWN = 'toonop-brush';
const COARSE = 'test.coarse';

plugins.register({
  id: 'test.shipped',
  api: PLUGIN_API,
  tools: {
    [COARSE]: {
      label: 'Грубая', title: 'Грубая', key: '', icon: '<path />', offPanel: true,
      stroke: {
        kind: 'pencil',
        rules: () => ({
          range: { min: 1, max: 300 },
          defaults: { width: 4, smooth: 3, minDistance: 3 },
          capture: (line: readonly number[]) => [...line],
        }),
        descriptor: ({ width, color }: { width: number; color: string }) =>
          ({ kind: 'pencil', geometry: 'smooth', width, color }),
      },
    },
  },
  presets: {
    'test.bar': {
      label: 'Bar',
      brush: COARSE,
      brushType: 'test.old',
      ux: { ...TOONOP_UX, tools: ['pencil', 'eraser', 'pipette'] },
    },
  },
  brushTypes: {
    'test.old': { label: 'Грубая', twins: { pencil: COARSE } },
  },
});

test('a preset is behaviour only — no set of buttons of its own', () => {
  for (const preset of presets()) {
    expect('features' in preset).toBe(false);
  }
  expect(DEFAULT_PRESET).toBe('toonop');
});

test('the list of presets is the register: the editor holds only its own', () => {
  expect(presets().map((preset) => preset.id)).toContain('toonop');
  expect(presets().find((preset) => preset.id === 'toonop')?.plugin).toBe('toonop');
  // Whatever a plugin brought stands beside it, named by nothing in the editor.
  expect(presets().find((preset) => preset.id === 'test.bar')?.plugin).toBe('test.shipped');
});

test('a preset names the brush a tool without its own follows', () => {
  expect(presetDefaultBrush('toonop')).toBe(OWN);
  expect(presetDefaultBrush('test.bar')).toBe(COARSE);
});

test('each preset owns a UX profile, and an unknown one falls back to the editor’s', () => {
  expect(presetUx('toonop')).toBe(TOONOP_UX);
  expect(presetUx('nope')).toBe(TOONOP_UX);
  expect(presetUx('test.bar').tools).toEqual(['pencil', 'eraser', 'pipette']);
});

test('a preset whose plugin is not there falls back without rewriting the choice', () => {
  expect(presetDefaultBrush('nope')).toBe(OWN);
});

test('parseUiConfig round-trips a valid stored config', () => {
  const config = {
    preset: 'test.bar',
    panels: defaultPanels(),
    floatPos: {},
    drawing: {
      defaultBrush: COARSE,
      byTool: Object.fromEntries(
        BRUSH_TOOLS.map((tool) => [tool, { width: 4, smooth: 3, minDistance: 3 }]),
      ),
      pickSource: 'layer' as const,
      panelHeight: 200,
      sides: { ...DEFAULT_DRAWING_UI_CONFIG.sides },
      panelCollapsed: false,
    },
    settings: { ...DEFAULT_SETTINGS },
  };
  expect(parseUiConfig(JSON.stringify(config))).toEqual(config);
});

test('the brush of a stored config is the one its preset names', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'test.bar',
    drawing: { multatorWidth: 4, tonio: { width: 7, smooth: 4, minDistance: 2 } },
  }));
  expect(parsed?.drawing.defaultBrush).toBe(COARSE);
});

test('a fresh config draws with the editor’s own brush', () => {
  expect(DEFAULT_DRAWING_UI_CONFIG.defaultBrush).toBe(OWN);
  expect(DEFAULT_DRAWING_UI_CONFIG.byTool).toEqual({});
});

test('old UI config migrates to independent safe profile defaults', () => {
  const old = { preset: 'toonop', features: { tools: true } };
  expect(parseUiConfig(JSON.stringify(old))?.drawing).toEqual(DEFAULT_DRAWING_UI_CONFIG);
});

test('brush records are clamped to supported ranges', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonop',
    drawing: { multatorWidth: -4, tonio: { width: 999, smooth: 0, minDistance: 99 } },
  }));
  // A config written when the records were keyed by the name of an editor
  // arrives in the one set, the wider canvas winning where both had a tool.
  const clamped = { width: 640, smooth: 1, minDistance: 30 };
  expect(parsed?.drawing).toEqual({
    defaultBrush: OWN,
    byTool: { pencil: clamped, eraser: clamped, feather: clamped, 'mega-eraser': clamped },
    pickSource: 'canvas',
    panelHeight: PANEL_HEIGHT_MIN,
    sides: DEFAULT_DRAWING_UI_CONFIG.sides,
    panelCollapsed: false,
  });
});

test('parseUiConfig rejects null, garbage, and non-config JSON', () => {
  expect(parseUiConfig(null)).toBeNull();
  expect(parseUiConfig('not json')).toBeNull();
  expect(parseUiConfig('42')).toBeNull();
  expect(parseUiConfig('{"features":{}}')).toBeNull(); // missing preset
  // A config with nothing but a preset is fine: the preset has a default.
  expect(parseUiConfig('{"preset":"toonop"}')?.panels).toEqual(defaultPanels());
});

test('an old config\'s flags become items put away, unknown ones ignored', () => {
  const parsed = parseUiConfig(
    JSON.stringify({ preset: 'toonop', features: { onionSkin: false, bogus: false } }),
  );
  expect(parsed?.preset).toBe('toonop');
  expect(parsed?.panels.hidden).toContain('onion');
  expect(parsed?.panels.rows.flat()).toContain('transport');
});

test('a preset starts from its own set on the same panels', () => {
  expect(parseUiConfig('{"preset":"toonop"}')?.panels).toEqual(defaultPanels());
  // A preset with a smaller toolset puts the editor's other keys away.
  const bar = parseUiConfig('{"preset":"test.bar"}')?.panels;
  expect(bar?.hidden).toContain('tool:feather');
  expect(bar?.left).toContain('tool:pencil');
});

test('a saved config from before the arrangement keeps what it had turned off', () => {
  const legacy = JSON.stringify({ preset: 'toonop', features: { export: false } });
  expect(parseUiConfig(legacy)?.panels.hidden).toContain('export');
});

test('the pipette source is part of the drawing config and defaults to the canvas', () => {
  expect(DEFAULT_DRAWING_UI_CONFIG.pickSource).toBe('canvas');
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonop',
    drawing: { pickSource: 'layer' },
  }));
  expect(parsed?.drawing.pickSource).toBe('layer');
});

test('an unknown pipette source falls back to the canvas', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonop',
    drawing: { pickSource: 'nonsense' },
  }));
  expect(parsed?.drawing.pickSource).toBe('canvas');
});


test('panel height is clamped to the draggable range and falls back when absent', () => {
  const stored = (panelHeight: unknown) => parseUiConfig(JSON.stringify({
    preset: 'toonio',
    drawing: { activeProfile: 'toonio', tonio: {}, panelHeight },
  }))?.drawing.panelHeight;

  expect(stored(300)).toBe(300);
  expect(stored(10)).toBe(PANEL_HEIGHT_MIN);
  expect(stored(9999)).toBe(PANEL_HEIGHT_MAX);
  expect(stored('tall')).toBe(DEFAULT_DRAWING_UI_CONFIG.panelHeight);
});

test('settings fall back to the reference defaults when absent or corrupted', () => {
  const base = { preset: 'toonio' };
  expect(parseUiConfig(JSON.stringify(base))?.settings).toEqual(DEFAULT_SETTINGS);
  expect(parseUiConfig(JSON.stringify({ ...base, settings: 'nope' }))?.settings).toEqual(DEFAULT_SETTINGS);
  expect(parseUiConfig(JSON.stringify({ ...base, settings: { paletteAutoAdd: 1 } }))?.settings)
    .toEqual(DEFAULT_SETTINGS);
});

test('settings round-trip through the stored config', () => {
  const settings = {
    mouseMode: true,
    crossCursor: false,
    chromePicker: false,
    lockTransform: true,
    paletteAutoAdd: false,
    paletteLimit: 120,
    autosaveMs: 0,
    showDraftsOnStart: false,
    pickerModel: 'wheel' as const,
    altLayout: true,
    removerTipShown: true,
    pluginCatalog: 'https://plugins.example/',
  };
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonio',
    settings,
  }));
  expect(parsed?.settings).toEqual(settings);
});

test('the picker model is one of the three, or the reference default', () => {
  const stored = (pickerModel: unknown) => parseUiConfig(JSON.stringify({
    preset: 'toonio',
    settings: { pickerModel },
  }))?.settings.pickerModel;

  expect(stored('rgb')).toBe('rgb');
  expect(stored('wheel')).toBe('wheel');
  expect(stored('spiral')).toBe('hsv');
  expect(DEFAULT_SETTINGS.pickerModel).toBe('hsv');
});

test('the palette limit is clamped to 30..300 and snapped to the 10 step', () => {
  const stored = (paletteLimit: unknown) => parseUiConfig(JSON.stringify({
    preset: 'toonio',
    settings: { paletteLimit },
  }))?.settings.paletteLimit;

  expect(stored(120)).toBe(120);
  expect(stored(124)).toBe(120);
  expect(stored(5)).toBe(PALETTE_LIMIT_MIN);
  expect(stored(9999)).toBe(PALETTE_LIMIT_MAX);
  expect(stored('many')).toBe(DEFAULT_SETTINGS.paletteLimit);
});

test('an autosave interval outside the offered list falls back to the default', () => {
  const stored = (autosaveMs: unknown) => parseUiConfig(JSON.stringify({
    preset: 'toonio',
    settings: { autosaveMs },
  }))?.settings.autosaveMs;

  for (const ms of AUTOSAVE_INTERVALS) {
    expect(stored(ms)).toBe(ms);
  }
  expect(stored(1234)).toBe(DEFAULT_SETTINGS.autosaveMs);
});

test('the reference defaults: autosave every minute, drafts offered, palette capped at 50', () => {
  expect(DEFAULT_SETTINGS.autosaveMs).toBe(60_000);
  expect(DEFAULT_SETTINGS.showDraftsOnStart).toBe(true);
  expect(DEFAULT_SETTINGS.paletteLimit).toBe(50);
  expect(DEFAULT_SETTINGS).not.toContainKey('theme');
});

test('what a brush starts at comes from the brush, not from a table here', () => {
  expect(defaultBrushOf(OWN)).toEqual({ width: 5, smooth: 3, minDistance: 3 });
  expect(defaultBrushOf(COARSE)).toEqual({ width: 4, smooth: 3, minDistance: 3 });
  // A brush that declares nothing still has somewhere to start from.
  expect(defaultBrushOf('pencil')).toEqual({ width: 4, smooth: 3, minDistance: 3 });
});

test('a config with one shared brush copies it into every tool', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonop',
    drawing: { tonio: { width: 7, smooth: 4, minDistance: 2 } },
  }));
  for (const tool of BRUSH_TOOLS) {
    expect(parsed?.drawing.byTool[tool]).toEqual({ width: 7, smooth: 4, minDistance: 2 });
  }
});

test('per-tool brushes are kept apart and clamped one by one', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonop',
    drawing: {
      byTool: {
        pencil: { width: 20, smooth: 3, minDistance: 3 },
        eraser: { width: 9999, smooth: 0, minDistance: 99 },
      },
    },
  }));
  expect(parsed?.drawing.byTool.pencil).toEqual({ width: 20, smooth: 3, minDistance: 3 });
  expect(parsed?.drawing.byTool.eraser).toEqual({ width: 640, smooth: 1, minDistance: 30 });
  expect(parsed?.drawing.byTool.feather).toEqual({ width: 4, smooth: 3, minDistance: 3 });
});

test('the records that are written down are the ones somebody set', () => {
  // A brush nobody touched has no record: it reads its own defaults, and an
  // empty one written for it would pin it to the editor's fallback instead.
  // A plugin's brush keeps its record — taken away and put back, it finds
  // its width where it left it.
  expect(copyBrushes({ pencil: { width: 20, smooth: 3, minDistance: 3 } })).toEqual({
    pencil: { width: 20, smooth: 3, minDistance: 3 },
  });
  const plugin = { [COARSE]: { width: 7, smooth: 3, minDistance: 3 } };
  expect(copyBrushes(plugin)).toEqual(plugin);
  expect(copyBrushes(plugin)[COARSE]).not.toBe(plugin[COARSE]);
});

test('a tool that draws no line borrows the pencil brush', () => {
  expect(BRUSH_TOOLS.map(brushToolOf)).toEqual([...BRUSH_TOOLS]);
  for (const tool of ['pipette', 'drag', 'lasso', 'distort']) {
    expect(brushToolOf(tool)).toBe('pencil');
  }
});

test('the browser eyedropper is on by default and a corrupted flag falls back', () => {
  expect(DEFAULT_SETTINGS.chromePicker).toBe(true);
  const stored = (chromePicker: unknown) => parseUiConfig(JSON.stringify({
    preset: 'toonio',
    settings: { chromePicker },
  }))?.settings.chromePicker;

  expect(stored(false)).toBe(false);
  expect(stored('yes')).toBe(true);
});

test('side panel widths are clamped, and an untouched side keeps its natural width', () => {
  const stored = (sides: unknown) => parseUiConfig(JSON.stringify({
    preset: 'toonio',
    drawing: { activeProfile: 'toonio', tonio: {}, sides },
  }))?.drawing.sides;

  expect(stored({ left: { width: 200, collapsed: true }, right: { width: 9999, collapsed: false } }))
    .toEqual({ left: { width: 200, collapsed: true }, right: { width: SIDE_WIDTH_MAX, collapsed: false } });
  expect(stored({ left: { width: 1, collapsed: 'yes' } })?.left)
    .toEqual({ width: SIDE_WIDTH_MIN.left, collapsed: false });
  expect(stored(undefined)).toEqual(DEFAULT_DRAWING_UI_CONFIG.sides);
});

test('each side has its own floor: the tools shrink to one narrow column, the palette box never squashes', () => {
  const stored = (sides: unknown) => parseUiConfig(JSON.stringify({
    preset: 'toonio',
    drawing: { activeProfile: 'toonio', tonio: {}, sides },
  }))?.drawing.sides;

  expect(SIDE_WIDTH_MIN.right).toBeGreaterThan(SIDE_WIDTH_MIN.left);
  expect(stored({ left: { width: 20 }, right: { width: 20 } }))
    .toEqual({
      left: { width: SIDE_WIDTH_MIN.left, collapsed: false },
      right: { width: SIDE_WIDTH_MIN.right, collapsed: false },
    });
});

test('a fresh config leaves both side panels open at their natural width', () => {
  expect(DEFAULT_DRAWING_UI_CONFIG.sides).toEqual({
    left: { width: null, collapsed: false },
    right: { width: null, collapsed: false },
  });
});

test('the bottom panel remembers being folded away, and a corrupted flag stays open', () => {
  const stored = (panelCollapsed: unknown) => parseUiConfig(JSON.stringify({
    preset: 'toonio',
    drawing: { activeProfile: 'toonio', tonio: {}, panelCollapsed },
  }))?.drawing.panelCollapsed;

  expect(stored(true)).toBe(true);
  expect(stored(undefined)).toBe(false);
  expect(stored('yes')).toBe(false);
  expect(DEFAULT_DRAWING_UI_CONFIG.panelCollapsed).toBe(false);
});

// --- Panel contents -------------------------------------------------------

test('an unknown preset falls back to the default arrangement', () => {
  expect(parseUiConfig('{"preset":"nope"}')?.panels).toEqual(defaultPanels());
});

test('the stored arrangement travels with the rest of the config', () => {
  const panels = movePanelItem(defaultPanels(), 'onion', 'left', 0);
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonop',
    panels,
  }));
  expect(parsed?.panels.left[0]).toBe('onion');
  expect(parsed?.panels.rows.flat()).not.toContain('onion');
});

test('a config saved before panels existed keeps the buttons it had turned off', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonop',
    features: { export: false },
  }));
  expect(parsed?.panels.hidden).toContain('export');
  expect(parsed?.panels.rows.flat()).toContain('onion');
});

test('an old config’s one width for a canvas becomes every brush’s own record', () => {
  // Before the split a whole canvas had one width; after it each brush has
  // its own — brought to the editor's canvas: 10 of a 600-wide one is 21.
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'test.bar',
    drawing: { multatorWidth: 10 },
  }));
  expect(parsed?.drawing.byTool.pencil.width).toBe(21);
  expect(parsed?.drawing.byTool.eraser.width).toBe(21);
});

test('a config keyed by canvas width comes to one set, the widths brought along', () => {
  // 20 of the 600-wide canvas is 43 of the editor's; where both canvases had
  // the tool, the record of the editor's own canvas stands.
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'test.bar',
    drawing: {
      byCanvas: {
        '600': { pencil: { width: 20 }, eraser: { width: 3 } },
        '1280': { pencil: { width: 7 } },
      },
    },
  }));
  expect(parsed?.drawing.byTool.pencil.width).toBe(7);
  expect(parsed?.drawing.byTool.eraser.width).toBe(6);
});

test('a brush of the register gets its own record, a tool that draws nothing takes the pencil’s', () => {
  expect(brushToolOf(COARSE)).toBe(COARSE);
  expect(brushToolOf('pipette')).toBe('pencil');
  expect(brushToolOf('mega-eraser')).toBe('mega-eraser');
});

test('a preset opens with the brush type it names, others with the everyday one', () => {
  expect(presetBrushType('test.bar')).toBe('test.old');
  expect(presetBrushType('toonop')).toBe('normal');
  expect(presetBrushType('нет такого')).toBe('normal');
});

test('the smoothing sliders are only for the brushes that say they reach them', () => {
  // The two numbers are the brush's own: one that thins by something else
  // never sees them, and says so rather than being named in a list here.
  expect(brushUsesSmoothing('pencil', OWN)).toBe(true);
  expect(brushUsesSmoothing('pencil', COARSE)).toBe(false);
  expect(brushUsesSmoothing(COARSE, OWN)).toBe(false);
});
