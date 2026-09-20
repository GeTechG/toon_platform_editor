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
import * as presets from './presets';

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

  test('every flag an old config could carry names a real item', () => {
    for (const id of Object.values(FEATURE_ITEM)) {
      expect(ids()).toContain(id);
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
    const left = defaultPanels().left;
    expect(left.slice(0, 3)).toEqual([toolItem('pencil'), toolItem('eraser'), toolItem('feather')]);
    expect(left).toContain('save');
  });

  test('a tool the profile does not draw simply draws nothing, wherever it sits', () => {
    // No per-preset arrangement decides this any more: the key is placed
    // like every other, and ToolKey renders nothing under a profile that
    // has no such tool (see ToolKey.svelte).
    expect(defaultPanels().left).toContain(toolItem('lasso'));
  });
});

describe('the transport is one item', () => {
  test('the step keys travel with play, not as items of their own', () => {
    expect(panelItem('steps-back')).toBeUndefined();
    expect(panelItem('steps-forward')).toBeUndefined();
    expect(panelItem('transport')?.label).toBe('Управление воспроизведением');
  });

  test('a layout saved when they were separate loses them, keeping play', () => {
    const stored = { ...defaultPanels(), rows: [['steps-back', 'transport', 'steps-forward']] };
    expect(normalizePanels(stored).rows[0][0]).toBe('transport');
  });
});

describe('the gear and the publish key', () => {
  test('both are items like everything else, at the end of the bar', () => {
    expect(panelItem('settings')?.kind).toBe('action');
    expect(panelItem('publish')?.kind).toBe('action');
    expect(defaultPanels().rows[1].slice(-2)).toEqual(['settings', 'publish']);
  });

  test('the gear can be moved but never put away — it is the way back', () => {
    const hidden = hidePanelItem(defaultPanels(), 'settings');
    expect(hidden.hidden).not.toContain('settings');
    expect(hidden.rows.flat()).toContain('settings');
    // …even when a stored layout claims otherwise.
    const stored = { ...defaultPanels(), rows: [], hidden: ['settings'] };
    expect(normalizePanels(stored).hidden).not.toContain('settings');
  });

  test('the gear moves to another panel like any item', () => {
    expect(movePanelItem(defaultPanels(), 'settings', 'left', 0).left[0]).toBe('settings');
  });
});

describe('the tool keys as a group', () => {
  test('«есть ли вообще инструменты» is any tool key still placed', () => {
    expect(anyToolVisible(defaultPanels())).toBe(true);
    let bare = defaultPanels();
    for (const item of PANEL_ITEMS) {
      if (toolOfItem(item.id)) {
        bare = hidePanelItem(bare, item.id);
      }
    }
    expect(anyToolVisible(bare)).toBe(false);
  });
});

describe('one arrangement for everybody', () => {
  test('there is a single default layout — no second setup per preset', () => {
    const panels = defaultPanels();
    expect(panels.left).toContain(toolItem('pencil'));
    expect(panels.rows[0]).toEqual(['timeline']);
  });

  test('colour and thickness each come in two widgets: the box and the plain one', () => {
    expect(panelItem('palette')?.label).toBe('Палитра');
    expect(panelItem('color')?.label).toBe('Цвет');
    expect(panelItem('brush')?.label).toBe('Кисть');
    expect(panelItem('brush-sizes')?.label).toBe('Толщина кисти');
    // The boxes are what the editor opens with; the plain pair waits on the
    // shelf for whoever wants it.
    const panels = defaultPanels();
    expect(panels.right).toContain('palette');
    expect(panels.right).toContain('brush');
    expect(panels.hidden).toContain('color');
    expect(panels.hidden).toContain('brush-sizes');
  });

  test('a preset starts from the same panels, with its own set in them', () => {
    const toonop = presets.presetPanels('toonop');
    expect(toonop).toEqual(defaultPanels());

    const multator = presets.presetPanels('multator');
    // Same slots, same machinery — fewer things placed.
    expect(multator.left).toContain(toolItem('pencil'));
    expect(multator.rows[0]).toEqual(['timeline']);
    expect(allPlaced(multator).sort()).toEqual(allPlaced(toonop).sort());
    expect(multator.hidden.length).toBeGreaterThan(toonop.hidden.length);
  });

  test('Multator swaps the palette box for its own colour widget', () => {
    const multator = presets.presetPanels('multator');
    expect(multator.hidden).toContain('palette');
    expect(multator.right).toContain('color');
    // …and the slider box for the reference's row of dots.
    expect(multator.hidden).toContain('brush');
    expect(multator.right).toContain('brush-sizes');
    // The keys it never had stay on the shelf.
    expect(multator.hidden).toContain('export');
    expect(multator.hidden).toContain(toolItem('lasso'));
  });

  test('the swapped widget takes the place of the one it replaces', () => {
    const multator = presets.presetPanels('multator');
    const toonop = presets.presetPanels('toonop');
    expect(multator.right.indexOf('color')).toBe(toonop.right.indexOf('palette'));
  });
});

describe('the default layouts', () => {
  test('the studio puts the tools left, the colour right and the strip in its own row', () => {
    const studio = defaultPanels();
    expect(studio.left).toContain(toolItem('pencil'));
    expect(studio.right).toContain('palette');
    expect(studio.rows[0]).toEqual(['timeline']);
    expect(studio.rows[1][0]).toBe('transport');
  });

  test('every item is placed or hidden, exactly once', () => {
    expect(allPlaced(defaultPanels()).slice().sort()).toEqual(ids().slice().sort());
  });
});

describe('reading a stored layout', () => {
  test('nothing stored is the layout default', () => {
    expect(normalizePanels(null)).toEqual(defaultPanels());
  });

  test('unknown ids and repeats are dropped', () => {
    const stored = { ...defaultPanels(), left: ['history', 'history', 'not-an-item'] };
    const left = normalizePanels(stored).left;
    expect(left.filter((id) => id === 'history')).toHaveLength(1);
    expect(left).not.toContain('not-an-item');
  });

  test('an item the stored layout never heard of returns to its default slot', () => {
    const stored = defaultPanels();
    const without = { ...stored, right: stored.right.filter((id) => id !== 'brush') };
    expect(normalizePanels(without).right).toContain('brush');
  });

  test('an item stored as hidden stays hidden', () => {
    const stored = hidePanelItem(defaultPanels(), 'onion');
    const back = normalizePanels(stored);
    expect(back.hidden).toContain('onion');
    expect(back.rows.flat()).not.toContain('onion');
  });
});

describe('rows are made and unmade', () => {
  test('a drop between rows makes a row there and pushes the rest down', () => {
    const start = defaultPanels();
    const next = movePanelItem(start, 'onion', 'newrow:1');
    expect(next.rows).toHaveLength(start.rows.length + 1);
    expect(next.rows[1]).toEqual(['onion']);
    expect(next.rows[2][0]).toBe(start.rows[1][0]);
  });

  test('a row left empty goes away instead of sitting there unhittable', () => {
    const start = defaultPanels();
    // rows[0] is the strip alone: moving it out empties that row.
    const next = movePanelItem(start, 'timeline', 'row:1', 0);
    expect(next.rows).toHaveLength(start.rows.length - 1);
    expect(next.rows[0][0]).toBe('timeline');
  });

  test('a row past the end is a new row at the end', () => {
    const start = defaultPanels();
    const next = movePanelItem(start, 'onion', `row:${start.rows.length + 5}`);
    expect(next.rows.at(-1)).toEqual(['onion']);
  });

  test('a stored layout never keeps an empty row', () => {
    const stored = { ...defaultPanels(), rows: [[], ['onion'], []] };
    expect(normalizePanels(stored).rows.every((row) => row.length > 0)).toBe(true);
  });
});

describe('a layout saved before rows could be made', () => {
  test('the drawing row of the old bar setup goes back to the columns', () => {
    // That row held the tool keys and the two boxes; as a row of the bottom
    // panel the boxes do not fit, so they return to where the arrangement
    // keeps them.
    const legacy = {
      bottom: ['timeline'],
      bar: ['transport'],
      draw: [toolItem('pencil'), 'brush', 'palette'],
    };
    const panels = normalizePanels(legacy);
    expect(panels.rows).toHaveLength(2);
    expect(panels.left).toContain(toolItem('pencil'));
    expect(panels.right).toContain('brush');
    expect(panels.right).toContain('palette');
  });

  test('its two bottom rows become the first two rows', () => {
    const legacy = {
      left: [toolItem('pencil')],
      right: ['palette'],
      bottom: ['timeline'],
      bar: ['transport'],
      float: [],
      hidden: [],
    };
    const panels = normalizePanels(legacy);
    expect(panels.rows[0]).toEqual(['timeline']);
    expect(panels.rows[1][0]).toBe('transport');
    expect(panels.left[0]).toBe(toolItem('pencil'));
  });
});

describe('moving an item', () => {
  test('it leaves the slot it came from and lands at the index given', () => {
    const next = movePanelItem(defaultPanels(), 'onion', 'left', 0);
    expect(next.left[0]).toBe('onion');
    expect(next.rows.flat()).not.toContain('onion');
  });

  test('no index means the end of the slot', () => {
    const next = movePanelItem(defaultPanels(), 'onion', 'left');
    expect(next.left.at(-1)).toBe('onion');
  });

  test('moving inside a slot reorders instead of duplicating', () => {
    const start = defaultPanels();
    const next = movePanelItem(start, start.rows[1][2], 'row:1', 0);
    expect(next.rows[1][0]).toBe(start.rows[1][2]);
    expect(next.rows[1]).toHaveLength(start.rows[1].length);
  });

  test('hiding an item is a move to the hidden slot', () => {
    expect(hidePanelItem(defaultPanels(), 'zoom').hidden).toContain('zoom');
  });
});

describe('showing an item again', () => {
  test('it goes back where its layout has it', () => {
    const hidden = hidePanelItem(defaultPanels(), 'zoom');
    expect(showPanelItem(hidden, 'zoom').rows.flat()).toContain('zoom');
  });

  test('there is no layers popup any more — the strip carries the rows', () => {
    expect(panelItem('layers')).toBeUndefined();
    expect(allPlaced(defaultPanels())).not.toContain('layers');
  });
});

describe('the slots a layout offers', () => {
  test('the slots are the two columns, the rows, the canvas and the shelf', () => {
    const slots = slotsOf(defaultPanels());
    expect(slots).toContain('left');
    expect(slots).toContain('right');
    expect(slots).toContain('float');
    expect(slots.at(-1)).toBe('hidden');
  });

  test('itemsOf reads a slot, and a row to be made is empty', () => {
    const studio = defaultPanels();
    expect(itemsOf(studio, 'row:0')).toEqual(['timeline']);
    expect(itemsOf(studio, 'left')).toEqual(studio.left);
    expect(itemsOf(studio, 'newrow:1')).toEqual([]);
    expect(itemsOf(studio, 'row:99')).toEqual([]);
  });

  test('every row the layout has is a slot, and there is one more to make', () => {
    const studio = defaultPanels();
    const slots = slotsOf(studio);
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
