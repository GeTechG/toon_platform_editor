import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { plugins } from '../plugins';
import { movePanelItem, samePanels, toolItem, type PanelLayout } from './panels';
import { loadUiConfig, parseUiConfig, presetPanels, saveUiConfig, type UiConfig } from './presets';

// The owner, 2026-10-10: «после изменений в дефолте у меня не меняется и
// приходится делать вручную сброс». An arrangement nobody rearranged is not
// the user's: it is the preset's, and follows the preset when that changes.
void plugins;

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}
const KEY = 'toon-editor:ui';
const config = (panels: PanelLayout): UiConfig => ({ ...parseUiConfig(JSON.stringify({ preset: 'toonop' }))!, panels });

describe('an untouched arrangement follows the preset', () => {
  let saved: unknown;
  let store: MemoryStorage;
  beforeEach(() => {
    saved = (globalThis as Record<string, unknown>).localStorage;
    store = new MemoryStorage();
    (globalThis as Record<string, unknown>).localStorage = store;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).localStorage = saved;
  });

  test('the preset’s own arrangement is not written down: what is read back is the preset’s of that day', () => {
    saveUiConfig(config(presetPanels('toonop')));
    expect(JSON.parse(store.getItem(KEY)!).panels).toBeUndefined();
    expect(JSON.parse(store.getItem(KEY)!).moves).toEqual([]);
    expect(samePanels(loadUiConfig()!.panels, presetPanels('toonop'))).toBe(true);
  });

  test('a rearranged one is written as what was moved (owner: «override»), and read back as it was', () => {
    const own = movePanelItem(presetPanels('toonop'), 'settings', 'left', 0);
    saveUiConfig(config(own));
    const stored = JSON.parse(store.getItem(KEY)!);
    expect(stored.panels).toBeUndefined();
    expect(stored.moves).toEqual([{ id: 'settings', slot: 'left', after: null }]);
    expect(samePanels(loadUiConfig()!.panels, own)).toBe(true);
  });

  test('the moves are made over the preset’s start of the day they are read: what nobody moved follows it', () => {
    // As if stored under another start: the gear first on the left, a key hidden — and nothing about the rest.
    const read = parseUiConfig(JSON.stringify({ preset: 'toonop', moves: [{ id: 'settings', slot: 'left', after: null }, { id: 'manual', slot: 'hidden', after: null }, 'rubbish', { id: 'x', slot: 'nowhere', after: null }] }))!;
    const start = presetPanels('toonop');
    expect(read.panels.left).toEqual(['settings', ...start.left]);
    expect(read.panels.right).toEqual(start.right);
    expect(read.panels.hidden).toContain('manual');
    expect(read.panels.rows[0]).toEqual(start.rows[0].filter((id) => id !== 'settings' && id !== 'manual'));
  });

  test('put back by hand, it is the preset’s again', () => {
    const own = movePanelItem(presetPanels('toonop'), 'settings', 'left', 0);
    saveUiConfig(config(own));
    saveUiConfig(config(presetPanels('toonop')));
    expect(JSON.parse(store.getItem(KEY)!).moves).toEqual([]);
  });

  test('one stored whole while it was toonop’s start until 2026-10-10 follows too: nobody arranged it', () => {
    const former = {
      left: ['brush-rail', 'history'],
      right: [],
      top: [
        'publish', 'save', 'export', 'audio', 'onion', 'settings', 'manual', 'fullscreen', 'saved', 'spring',
        ...['pencil', 'eraser', 'feather', 'mega-eraser', 'pipette', 'drag', 'lasso'].map(toolItem),
        'color-key',
      ],
      rows: [['fps', 'add-frame', 'transport'], ['timeline']],
      float: [],
      hidden: ['color', 'brush-sizes', 'delete-frame', 'copy', 'paste', 'merge', toolItem('pixel'), toolItem('distort'), 'drafts', 'palette', 'brush', 'brush-key'],
    };
    const read = parseUiConfig(JSON.stringify({ preset: 'toonop', panels: former }))!;
    expect(samePanels(read.panels, presetPanels('toonop'))).toBe(true);
    // …but not once a hand has been at it.
    const touched = parseUiConfig(JSON.stringify({ preset: 'toonop', panels: { ...former, right: ['palette'], hidden: former.hidden.filter((id) => id !== 'palette') } }))!;
    expect(touched.panels.right).toEqual(['palette']);
  });

  test('a tab that did not rearrange keeps what is stored — the preset’s too, when another tab reset to it', () => {
    saveUiConfig(config(presetPanels('toonop')));
    const stale = movePanelItem(presetPanels('toonop'), 'settings', 'left', 0);
    saveUiConfig(config(stale), false);
    expect(JSON.parse(store.getItem(KEY)!).moves).toEqual([]);
  });
});
