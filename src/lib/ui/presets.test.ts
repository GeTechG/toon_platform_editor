import { expect, test } from 'bun:test';
import {
  BRUSH_TOOLS,
  brushToolOf,
  brushUsesSmoothing,
  DEFAULT_DRAWING_UI_CONFIG,
  AUTOSAVE_INTERVALS,
  DEFAULT_PRESET,
  DEFAULT_SETTINGS,
  PRESETS,
  parseUiConfig,
  PANEL_HEIGHT_MAX,
  PANEL_HEIGHT_MIN,
  SIDE_WIDTH_MAX,
  SIDE_WIDTH_MIN,
  PALETTE_LIMIT_MAX,
  PALETTE_LIMIT_MIN,
  presetBrushType,
  presetDefaultDialect,
  presetUx,
} from './presets';
import { defaultPanels, movePanelItem } from './panels';
import { UX_PROFILES } from './ux-profile';

test('a preset is behaviour only — no set of buttons of its own', () => {
  for (const preset of PRESETS) {
    expect('features' in preset).toBe(false);
  }
  expect(DEFAULT_PRESET).toBe('toonop');
});

test('compatibility presets select their drawing profile through existing preset logic', () => {
  expect(PRESETS.find((preset) => preset.id === 'toonop')?.defaultDialect).toBe('toonio');
  expect(PRESETS.find((preset) => preset.id === 'multator')?.defaultDialect).toBe('multator');
  expect(PRESETS.find((preset) => preset.id === 'toonio')?.defaultDialect).toBe('toonio');
});

test('each preset owns a UX profile: Multator reproduces the reference, others keep toonop', () => {
  expect(presetUx('multator')).toBe(UX_PROFILES.multator);
  expect(presetUx('toonop')).toBe(UX_PROFILES.toonop);
  expect(presetUx('toonio')).toBe(UX_PROFILES.toonio);
});

test('UX profile lookup falls back to toonop for an unknown preset', () => {
  expect(presetUx('nope')).toBe(UX_PROFILES.toonop);
});

test('preset drawing profile lookup falls back to the Toonop profile', () => {
  expect(presetDefaultDialect('toonio')).toBe('toonio');
  expect(presetDefaultDialect('nope')).toBe('toonio');
});

test('parseUiConfig round-trips a valid stored config', () => {
  const config = {
    preset: 'multator',
    panels: defaultPanels(),
    floatPos: {},
    drawing: {
      activeProfile: 'multator' as const,
      tonioByTool: { ...DEFAULT_DRAWING_UI_CONFIG.tonioByTool },
      multatorByTool: { ...DEFAULT_DRAWING_UI_CONFIG.multatorByTool },
      pickSource: 'layer' as const,
      panelHeight: 200,
      sides: { ...DEFAULT_DRAWING_UI_CONFIG.sides },
      panelCollapsed: false,
    },
    settings: { ...DEFAULT_SETTINGS },
  };
  expect(parseUiConfig(JSON.stringify(config))).toEqual(config);
});

test('stored drawing profile is normalized to the selected preset', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonio',
    drawing: {
      activeProfile: 'multator',
      multatorWidth: 4,
      tonio: { width: 7, smooth: 4, minDistance: 2 },
    },
  }));
  expect(parsed?.drawing.activeProfile).toBe('toonio');
});

test('a fresh config draws the Tonio line, the way the default Toonop preset asks', () => {
  expect(DEFAULT_DRAWING_UI_CONFIG.activeProfile).toBe('toonio');
});

test('old UI config migrates to independent safe profile defaults', () => {
  const old = { preset: 'toonop', features: { tools: true } };
  expect(parseUiConfig(JSON.stringify(old))?.drawing).toEqual(DEFAULT_DRAWING_UI_CONFIG);
});

test('drawing profile settings are clamped to supported ranges', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonop',
    drawing: { activeProfile: 'bad', multatorWidth: -4, tonio: { width: 999, smooth: 0, minDistance: 99 } },
  }));
  const clamped = { width: 500, smooth: 1, minDistance: 30 };
  const multator = { width: 1, smooth: 3, minDistance: 3 };
  expect(parsed?.drawing).toEqual({
    activeProfile: 'toonio',
    tonioByTool: { pencil: clamped, eraser: clamped, feather: clamped, 'mega-eraser': clamped },
    multatorByTool: { pencil: multator, eraser: multator, feather: multator, 'mega-eraser': multator },
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
  const multator = parseUiConfig('{"preset":"multator"}')?.panels;
  // Everything under the canvas, its own widgets, fewer keys.
  expect(multator?.left).toEqual([]);
  expect(multator?.rows[2]).toContain('color');
  expect(multator?.hidden).toContain('export');
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
    pluginRegistry: 'https://plugins.example/',
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

test('every brush tool starts from the same Tonio defaults', () => {
  expect(DEFAULT_DRAWING_UI_CONFIG.tonioByTool).toEqual({
    pencil: { width: 5, smooth: 3, minDistance: 3 },
    eraser: { width: 5, smooth: 3, minDistance: 3 },
    feather: { width: 5, smooth: 3, minDistance: 3 },
    'mega-eraser': { width: 5, smooth: 3, minDistance: 3 },
  });
});

test('a config with one shared Tonio brush copies it into every tool', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonio',
    drawing: { activeProfile: 'toonio', tonio: { width: 7, smooth: 4, minDistance: 2 } },
  }));
  for (const tool of BRUSH_TOOLS) {
    expect(parsed?.drawing.tonioByTool[tool]).toEqual({ width: 7, smooth: 4, minDistance: 2 });
  }
});

test('per-tool brushes are kept apart and clamped one by one', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonio',
    drawing: {
      activeProfile: 'toonio',
      tonioByTool: {
        pencil: { width: 20, smooth: 3, minDistance: 3 },
        eraser: { width: 999, smooth: 0, minDistance: 99 },
      },
    },
  }));
  expect(parsed?.drawing.tonioByTool.pencil).toEqual({ width: 20, smooth: 3, minDistance: 3 });
  expect(parsed?.drawing.tonioByTool.eraser).toEqual({ width: 500, smooth: 1, minDistance: 30 });
  expect(parsed?.drawing.tonioByTool.feather).toEqual(DEFAULT_DRAWING_UI_CONFIG.tonioByTool.feather);
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

test('an old config’s one Multator width becomes every Multator brush’s own record', () => {
  // Before the split the whole Multator canvas had one width; after it each
  // brush has its own, and nobody’s jumps on the upgrade.
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'multator',
    drawing: { activeProfile: 'multator', multatorWidth: 10 },
  }));
  expect(parsed?.drawing.multatorByTool.pencil.width).toBe(10);
  expect(parsed?.drawing.multatorByTool.eraser.width).toBe(10);
});

test('two brushes of one canvas keep two records', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'multator',
    drawing: {
      activeProfile: 'multator',
      multatorByTool: { pencil: { width: 20 }, eraser: { width: 3 } },
    },
  }));
  expect(parsed?.drawing.multatorByTool.pencil.width).toBe(20);
  expect(parsed?.drawing.multatorByTool.eraser.width).toBe(3);
});

test('a brush of the register gets its own record, a tool that draws nothing takes the pencil’s', () => {
  expect(brushToolOf('pixel')).toBe('pixel');
  expect(brushToolOf('oldschool')).toBe('oldschool');
  expect(brushToolOf('pipette')).toBe('pencil');
  expect(brushToolOf('mega-eraser')).toBe('mega-eraser');
});

test('opening Multator puts the multator brush in hand, the others the everyday one', () => {
  expect(presetBrushType('multator')).toBe('multator');
  expect(presetBrushType('toonop')).toBe('normal');
  expect(presetBrushType('toonio')).toBe('normal');
  expect(presetBrushType('нет такого')).toBe('normal');
});

test('the smoothing sliders are only for the brushes they reach', () => {
  // Tonio's smoothing and minimum distance are applied by the Tonio commit
  // alone: a brush on the Multator canvas is simplified by Lang instead, and
  // one that collects or commits its own points never sees either number.
  expect(brushUsesSmoothing('pencil', 'toonio')).toBe(true);
  expect(brushUsesSmoothing('pencil', 'multator')).toBe(false);
  expect(brushUsesSmoothing('multator-pencil', 'toonio')).toBe(false);
  expect(brushUsesSmoothing('oldschool', 'toonio')).toBe(false);
  expect(brushUsesSmoothing('pixel', 'toonio')).toBe(false);
});
