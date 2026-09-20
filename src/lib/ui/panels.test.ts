import { describe, expect, test } from 'bun:test';
import { UX_PROFILES } from './ux-profile';
import {
  FEATURE_ITEM,
  TOOL_KEYS,
  anyToolVisible,
  toolItem,
  toolOfItem,
  KIND_LABELS,
  slotLabel,
  slotsOf,
  allPlaced,
  itemsOf,
  PANEL_ITEMS,
  defaultPanels,
  hidePanelItem,
  movePanelItem,
  normalizePanels,
  panelItem,
  showPanelItem,
} from './panels';
import { FEATURE_ORDER, presetPanels } from './presets';

const ids = () => PANEL_ITEMS.map((item) => item.id);

describe('the item registry', () => {
  test('every item has a unique id, a kind and a label', () => {
    expect(new Set(ids()).size).toBe(PANEL_ITEMS.length);
    for (const item of PANEL_ITEMS) {
      expect(['tool', 'action', 'widget']).toContain(item.kind);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  test('panelItem finds an item by id and refuses an unknown one', () => {
    expect(panelItem('history')?.kind).toBe('action');
    expect(panelItem('nothing-like-this')).toBeUndefined();
  });

  test('every feature key names a real item', () => {
    for (const key of FEATURE_ORDER) {
      expect(ids()).toContain(FEATURE_ITEM[key]);
    }
  });
});

describe('every tool is its own item', () => {
  test('the registry carries one item per selectable tool, with its key', () => {
    for (const tool of UX_PROFILES.toonop.tools) {
      const item = panelItem(toolItem(tool));
      expect(item?.kind).toBe('tool');
      expect(item?.label).toBe(TOOL_KEYS[tool].label);
    }
  });

  test('a tool item names the tool it selects, and nothing else does', () => {
    expect(toolOfItem(toolItem('pencil'))).toBe('pencil');
    expect(toolOfItem('history')).toBeNull();
  });

  test('the studio rail is the tools, one after another, then the save key', () => {
    const left = defaultPanels('studio').left;
    expect(left.slice(0, 3)).toEqual([toolItem('pencil'), toolItem('eraser'), toolItem('feather')]);
    expect(left).toContain('save');
  });

  test('a preset that does not offer a tool starts with it put away', () => {
    // Multator draws pencil, eraser and the pipette only.
    expect(presetPanels('multator').hidden).toContain(toolItem('lasso'));
    expect(presetPanels('multator').rows[2]).toContain(toolItem('pencil'));
  });
});

describe('the transport is one item', () => {
  test('the step keys travel with play, not as items of their own', () => {
    expect(panelItem('steps-back')).toBeUndefined();
    expect(panelItem('steps-forward')).toBeUndefined();
    expect(panelItem('transport')?.label).toBe('Управление воспроизведением');
  });

  test('a layout saved when they were separate loses them, keeping play', () => {
    const stored = { ...defaultPanels('studio'), rows: [['steps-back', 'transport', 'steps-forward']] };
    expect(normalizePanels(stored, 'studio').rows[0][0]).toBe('transport');
  });
});

describe('the gear and the publish key', () => {
  test('both are items like everything else, at the end of the bar', () => {
    expect(panelItem('settings')?.kind).toBe('action');
    expect(panelItem('publish')?.kind).toBe('action');
    expect(defaultPanels('studio').rows[1].slice(-2)).toEqual(['settings', 'publish']);
    expect(defaultPanels('bar').rows[1]).toContain('settings');
  });

  test('the gear can be moved but never put away — it is the way back', () => {
    const hidden = hidePanelItem(defaultPanels('studio'), 'settings');
    expect(hidden.hidden).not.toContain('settings');
    expect(hidden.rows.flat()).toContain('settings');
    // …even when a stored layout claims otherwise.
    const stored = { ...defaultPanels('studio'), rows: [], hidden: ['settings'] };
    expect(normalizePanels(stored, 'studio').hidden).not.toContain('settings');
  });

  test('the gear moves to another panel like any item', () => {
    expect(movePanelItem(defaultPanels('studio'), 'settings', 'left', 0).left[0]).toBe('settings');
  });
});

describe('the tool keys as a group', () => {
  test('«есть ли вообще инструменты» is any tool key still placed', () => {
    expect(anyToolVisible(defaultPanels('studio'))).toBe(true);
    let bare = defaultPanels('studio');
    for (const item of PANEL_ITEMS) {
      if (toolOfItem(item.id)) {
        bare = hidePanelItem(bare, item.id);
      }
    }
    expect(anyToolVisible(bare)).toBe(false);
  });
});

describe('the default layouts', () => {
  test('the studio puts the tools left, the colour right and the strip in its own row', () => {
    const studio = defaultPanels('studio');
    expect(studio.left).toContain(toolItem('pencil'));
    expect(studio.right).toContain('palette');
    expect(studio.rows[0]).toEqual(['timeline']);
    expect(studio.rows[1][0]).toBe('transport');
  });

  test('the bar layout keeps its three rows and leaves the columns empty', () => {
    const bar = defaultPanels('bar');
    expect(bar.left).toEqual([]);
    expect(bar.right).toEqual([]);
    expect(bar.rows).toHaveLength(3);
    // Reference order (multator.ru ToolPanel): keys, thickness, colour.
    const draw = bar.rows[2];
    expect(draw[0]).toBe(toolItem('pencil'));
    expect(draw.at(-2)).toBe('brush');
    expect(draw.at(-1)).toBe('palette');
  });

  test('every item is placed or hidden, once, in both layouts', () => {
    for (const layout of ['studio', 'bar'] as const) {
      const all = allPlaced(defaultPanels(layout));
      expect(all.slice().sort()).toEqual(ids().slice().sort());
    }
  });
});

describe('reading a stored layout', () => {
  test('nothing stored is the layout default', () => {
    expect(normalizePanels(null, 'studio')).toEqual(defaultPanels('studio'));
  });

  test('unknown ids and repeats are dropped', () => {
    const stored = { ...defaultPanels('studio'), left: ['history', 'history', 'not-an-item'] };
    const left = normalizePanels(stored, 'studio').left;
    expect(left.filter((id) => id === 'history')).toHaveLength(1);
    expect(left).not.toContain('not-an-item');
  });

  test('an item the stored layout never heard of returns to its default slot', () => {
    const stored = defaultPanels('studio');
    const without = { ...stored, right: stored.right.filter((id) => id !== 'brush') };
    expect(normalizePanels(without, 'studio').right).toContain('brush');
  });

  test('an item stored as hidden stays hidden', () => {
    const stored = hidePanelItem(defaultPanels('studio'), 'onion');
    const back = normalizePanels(stored, 'studio');
    expect(back.hidden).toContain('onion');
    expect(back.rows.flat()).not.toContain('onion');
  });
});

describe('rows are made and unmade', () => {
  test('a drop between rows makes a row there and pushes the rest down', () => {
    const start = defaultPanels('studio');
    const next = movePanelItem(start, 'onion', 'newrow:1');
    expect(next.rows).toHaveLength(start.rows.length + 1);
    expect(next.rows[1]).toEqual(['onion']);
    expect(next.rows[2][0]).toBe(start.rows[1][0]);
  });

  test('a row left empty goes away instead of sitting there unhittable', () => {
    const start = defaultPanels('studio');
    // rows[0] is the strip alone: moving it out empties that row.
    const next = movePanelItem(start, 'timeline', 'row:1', 0);
    expect(next.rows).toHaveLength(start.rows.length - 1);
    expect(next.rows[0][0]).toBe('timeline');
  });

  test('a row past the end is a new row at the end', () => {
    const start = defaultPanels('studio');
    const next = movePanelItem(start, 'onion', `row:${start.rows.length + 5}`);
    expect(next.rows.at(-1)).toEqual(['onion']);
  });

  test('a stored layout never keeps an empty row', () => {
    const stored = { ...defaultPanels('studio'), rows: [[], ['onion'], []] };
    expect(normalizePanels(stored, 'studio').rows.every((row) => row.length > 0)).toBe(true);
  });
});

describe('a layout saved before rows could be made', () => {
  test('its three fixed rows become the first three rows', () => {
    const legacy = {
      left: [toolItem('pencil')],
      right: ['palette'],
      bottom: ['timeline'],
      bar: ['transport'],
      draw: ['brush'],
      float: [],
      hidden: [],
    };
    const panels = normalizePanels(legacy, 'studio');
    expect(panels.rows[0]).toEqual(['timeline']);
    expect(panels.rows[1][0]).toBe('transport');
    expect(panels.rows[2][0]).toBe('brush');
    expect(panels.left[0]).toBe(toolItem('pencil'));
  });
});

describe('moving an item', () => {
  test('it leaves the slot it came from and lands at the index given', () => {
    const next = movePanelItem(defaultPanels('studio'), 'onion', 'left', 0);
    expect(next.left[0]).toBe('onion');
    expect(next.rows.flat()).not.toContain('onion');
  });

  test('no index means the end of the slot', () => {
    const next = movePanelItem(defaultPanels('studio'), 'onion', 'left');
    expect(next.left.at(-1)).toBe('onion');
  });

  test('moving inside a slot reorders instead of duplicating', () => {
    const start = defaultPanels('studio');
    const next = movePanelItem(start, start.rows[1][2], 'row:1', 0);
    expect(next.rows[1][0]).toBe(start.rows[1][2]);
    expect(next.rows[1]).toHaveLength(start.rows[1].length);
  });

  test('hiding an item is a move to the hidden slot', () => {
    expect(hidePanelItem(defaultPanels('studio'), 'zoom').hidden).toContain('zoom');
  });
});

describe('showing an item again', () => {
  test('it goes back where its layout has it', () => {
    const hidden = hidePanelItem(defaultPanels('studio'), 'zoom');
    expect(showPanelItem(hidden, 'zoom', 'studio').rows.flat()).toContain('zoom');
  });

  test('there is no layers popup any more — the strip carries the rows', () => {
    expect(panelItem('layers')).toBeUndefined();
    for (const kind of ['studio', 'bar'] as const) {
      expect(allPlaced(defaultPanels(kind))).not.toContain('layers');
    }
  });
});

describe('the slots a layout offers', () => {
  test('the studio has its two columns, the bar layout does not', () => {
    expect(slotsOf(defaultPanels('studio'), 'studio')).toContain('left');
    expect(slotsOf(defaultPanels('bar'), 'bar')).not.toContain('left');
    // Hidden is offered everywhere: it is how an item is put away.
    for (const kind of ['studio', 'bar'] as const) {
      expect(slotsOf(defaultPanels(kind), kind).at(-1)).toBe('hidden');
    }
  });

  test('itemsOf reads a slot, and a row to be made is empty', () => {
    const studio = defaultPanels('studio');
    expect(itemsOf(studio, 'row:0')).toEqual(['timeline']);
    expect(itemsOf(studio, 'left')).toEqual(studio.left);
    expect(itemsOf(studio, 'newrow:1')).toEqual([]);
    expect(itemsOf(studio, 'row:99')).toEqual([]);
  });

  test('every row the layout has is a slot, and there is one more to make', () => {
    const studio = defaultPanels('studio');
    const slots = slotsOf(studio, 'studio');
    expect(slots).toContain('row:0');
    expect(slots).toContain('row:1');
    expect(slots).toContain(`newrow:${studio.rows.length}`);
    expect(slotLabel('row:0')).toBe('Строка 1');
    expect(slotLabel('newrow:2')).toBe('Новая строка');
  });

  test('every kind of item has a word for it', () => {
    for (const item of PANEL_ITEMS) {
      expect(KIND_LABELS[item.kind].length).toBeGreaterThan(0);
    }
  });
});

// --- Wiring ---------------------------------------------------------------
// The state class and the sheets are runes/Svelte, so they are asserted as
// source (same contract style as layers-panel.test.ts).
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const sheet = await Bun.file(new URL('./SettingsSheet.svelte', import.meta.url)).text();

describe('the editor is arranged from the config', () => {
  test('the state holds the arrangement, moves items and writes it down', () => {
    expect(state).toContain('panels = $state');
    expect(state).toContain('movePanelItem(');
    expect(state).toContain('panels: $state.snapshot(this.panels)');
  });

  test('what a button does is still read off the arrangement', () => {
    // `features` is no longer a second switch beside placement: an item is
    // offered exactly when it sits in a panel.
    expect(state).toContain('panelItemVisible(this.panels');
  });

  test('every panel draws the items the config puts in it', () => {
    expect(editorUi).toContain('{#snippet slot(');
    expect(editorUi).toContain('{#snippet panelItem(');
    expect(editorUi).toContain('{@render slot(editor.panels.left)');
    expect(editorUi).toContain('{@render slot(editor.panels.right)');
    // The bottom panel is as many rows as the arrangement has.
    expect(editorUi).toContain('{#each editor.panels.rows as row, i (i)}');
    expect(editorUi).toContain('data-slot="row:{i}"');
  });

  test('the settings sheet arranges the panels', () => {
    expect(sheet).toContain('slotLabel(slot)');
    expect(sheet).toContain('editor.movePanelItem');
    expect(sheet).toContain('Расположение');
  });
});
