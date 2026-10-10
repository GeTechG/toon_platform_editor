import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import ru from '../i18n/ru.json';
import { plugins } from '../plugins';
import { PLUGIN_API } from '../plugins/contract';
import { loadInstalled } from '../plugins/install';
import { putInstalled } from '../plugins/store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';
import { defaultPanels, movePanelItem, normalizePanels, samePanels, toolItem, type PanelLayout } from './panels';
import { loadUiConfig, saveUiConfig } from './presets';
import { importWorkspaces, parseWorkspaces, withWorkspace, workspaceConflicts } from './workspaces';

// Owner's answers on the arrangement after the thirteenth audit: a reload is
// not a plugin coming back, a file does not silently replace a workspace of
// the same name, and where the windows stand is part of an arrangement.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const member = (head: string): string => {
  const from = state.indexOf(head);
  return from < 0 ? '' : state.slice(from, state.indexOf('\n  }\n', from));
};

const PLUGIN = 'o13stamp';
const TOOL = 'o13-stamp';
const KEY = toolItem(TOOL);
const manifest = {
  id: PLUGIN,
  api: PLUGIN_API,
  tools: { [TOOL]: { label: 'Штамп', title: 'Штамп', key: '', icon: '<path />' } },
};

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}

/** The owner's own arrangement: the plugin's key second on the left, after the pencil. */
function arranged(): PanelLayout {
  const base = defaultPanels();
  return { ...base, left: [base.left[0], KEY, ...base.left.slice(1)] };
}

describe('a reload is not a plugin coming back', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    setIndexedDB(fakeIndexedDB(new Map(), 1));
  });
  afterEach(() => {
    plugins.remove(PLUGIN);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  async function install(): Promise<void> {
    await putInstalled({
      id: PLUGIN, version: '1.0.0', name: PLUGIN, description: '', icon: '', code: 'stamp', source: 'catalog', installed: 1,
    });
    await loadInstalled(plugins, {
      fetch: async () => ({ text: async () => '' }),
      evaluate: async () => ({ default: manifest }),
    });
  }

  it('the key of a plugin not loaded yet waits in its place instead of being thrown out', async () => {
    const panels = arranged();
    storage.setItem('toon-editor:ui', JSON.stringify({ preset: 'toonop', panels, floatPos: {} }));
    // The constructor reads the config before the plugins are in.
    const saved = loadUiConfig();
    expect(saved?.panels.left[1]).toBe(KEY);
    // …and the first write, before they are, keeps it too.
    saveUiConfig(saved!);
    // Written as moves over the preset's start since 2026-10-10: the key is one of them, and is read back in its place.
    expect(JSON.parse(storage.getItem('toon-editor:ui')!).moves.map((move: { id: string }) => move.id)).toContain(KEY);
    expect(loadUiConfig()?.panels.left[1]).toBe(KEY);

    await install();
    // What refreshPlugins does once loadInstalled is through.
    const refreshed = normalizePanels(saved!.panels);
    expect(refreshed.left).toEqual(panels.left);
    expect(samePanels(refreshed, panels)).toBe(true);
  });

  it('the saved workspaces keep the key through a reload as well', async () => {
    const raw = JSON.stringify(withWorkspace([], 'Стол', arranged(), {}));
    const read = parseWorkspaces(raw);
    expect(read[0].panels.left[1]).toBe(KEY);
    await install();
    expect(normalizePanels(read[0].panels).left[1]).toBe(KEY);
  });

  it('a plugin really taken off loses its key, and one that comes back takes the preset place', async () => {
    await install();
    const withKey = normalizePanels(arranged());
    plugins.remove(PLUGIN);
    const gone = normalizePanels(withKey);
    expect(gone.left).not.toContain(KEY);
    expect(gone.hidden).not.toContain(KEY);
    await install();
    const back = normalizePanels(gone);
    // The panel its preset keeps it in (the left column), not the old spot.
    expect(defaultPanels().left).toContain(KEY);
    expect(back.left).toContain(KEY);
    expect(back.left.indexOf(KEY)).not.toBe(1);
  });

  it('the editor reads keys as waiting only until the plugins are in, then cleans the workspaces too', () => {
    const refresh = member('refreshPlugins(): void');
    expect(refresh).toContain('normalizePanels(this.panels)');
    // The cleaning is a member of its own since the 18th audit (a file load runs it too).
    expect(refresh).toContain('this.dropGhostKeys()');
    const clean = member('private dropGhostKeys(): void');
    expect(clean).toContain('this.workspaces');
    expect(clean).toContain('saveWorkspaces(');
    // A preset whose plugin arrives late does not take the arrangement with it.
    expect(refresh).toMatch(/const kept = this\.panels;[^]*applyPreset\(this\.preset, false\);[^]*this\.panels = kept;/);
  });
});

describe('a file does not silently replace a workspace of the same name', () => {
  const mine = withWorkspace([], 'Стол', defaultPanels(), {});
  const other = movePanelItem(defaultPanels(), 'onion', 'left', 0);

  it('names the workspaces the file would replace with another arrangement', () => {
    const file = JSON.stringify([
      ...withWorkspace([], 'Стол', other, {}),
      ...withWorkspace([], 'Планшет', other, {}),
    ]);
    expect(workspaceConflicts(mine, file)).toEqual(['Стол']);
    // The same arrangement under the same name is nothing to ask about.
    expect(workspaceConflicts(mine, JSON.stringify(mine))).toEqual([]);
  });

  it('a «no» keeps those and still loads the rest', () => {
    const file = JSON.stringify([
      ...withWorkspace([], 'Стол', other, {}),
      ...withWorkspace([], 'Планшет', other, {}),
    ]);
    const { workspaces, loaded } = importWorkspaces(mine, file, new Set(['Стол']));
    expect(loaded).toBe(1);
    expect(samePanels(workspaces.find((w) => w.name === 'Стол')!.panels, defaultPanels())).toBe(true);
    expect(workspaces.some((w) => w.name === 'Планшет')).toBe(true);
  });

  it('asks as «Сохранить» does, one name or several', () => {
    const load = member('importWorkspaces(raw: string)');
    expect(load).toContain('workspaceConflicts(');
    expect(load).toContain("t('arrange.import_overwrite_confirm'");
    expect(load).toContain("t('arrange.import_overwrite_many_confirm'");
    expect(load).toContain('this.confirmed(');
    expect(ru.arrange.import_overwrite_confirm).toContain('{{name}}');
    expect(ru.arrange.import_overwrite_many_confirm).toContain('{{names}}');
    expect(ru.arrange.load_kept).toBeTruthy();
    expect(arranger).toContain("t('arrange.load_kept')");
  });
});

describe('where the windows stand is part of an arrangement', () => {
  const two = movePanelItem(movePanelItem(defaultPanels(), 'color', 'float'), 'fps', 'float');
  const raised = movePanelItem(two, 'color', 'float');

  it('a window moved elsewhere is another arrangement', () => {
    const at = { color: { x: 100, y: 100 }, fps: { x: 400, y: 80 } };
    expect(samePanels(two, two, at, { ...at, color: { x: 300, y: 100 } })).toBe(false);
    expect(samePanels(two, two, at, at)).toBe(true);
  });

  it('the stacking order still is not, and a pixel of jitter is not a move', () => {
    const at = { color: { x: 100, y: 100 }, fps: { x: 400, y: 80 } };
    expect(samePanels(two, raised, at, at)).toBe(true);
    expect(samePanels(two, two, at, { ...at, color: { x: 101, y: 99.4 } })).toBe(true);
  });

  it('a window with no place stored stands where the window draws it, and a docked one has none', () => {
    expect(samePanels(two, two, {}, { color: { x: 24, y: 24 }, fps: { x: 24, y: 24 } })).toBe(true);
    // A position left behind by an item that is back in its panel counts for nothing.
    expect(samePanels(defaultPanels(), defaultPanels(), { color: { x: 1, y: 1 } }, {})).toBe(true);
  });

  it('switching, resetting and saving compare the places as stored, not as drawn', () => {
    const guard = member('private mayReplacePanels(');
    expect(guard).toMatch(/samePanels\(this\.panels, next, this\.floatPos, nextPos\)/);
    expect(guard).toMatch(/samePanels\(this\.panels, w\.panels, this\.floatPos, w\.floatPos\)/);
    expect(member('applyWorkspace(id: number)')).toContain('workspace.floatPos');
    expect(member('saveWorkspace(name: string)')).toMatch(/samePanels\(same\.panels, this\.panels, same\.floatPos, this\.floatPos\)/);
  });
});

describe('owner thirteenth, the coordinator: a late preset keeps the brush it was left with', () => {
  it('a reload is not a pick: the saved default brush and brush type survive the plugin arriving', async () => {
    const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
    const refresh = state.slice(state.indexOf('  refreshPlugins(): void {'), state.indexOf('this.panels = normalizePanels(this.panels);'));
    expect(refresh).toContain('const keptBrush = this.defaultBrush;');
    expect(refresh).toContain('const keptType = this.brushType;');
    expect(refresh).toContain('this.defaultBrush = keptBrush;');
    expect(refresh).toContain('this.brushType = keptType;');
  });
});
