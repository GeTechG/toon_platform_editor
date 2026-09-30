import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { saveUiConfig } from './presets';

// Owner answers after the sixteenth audit, windows and layout: floating
// windows over the arrange plate, and two tabs no longer overwriting each
// other's panel arrangement with a stale copy. The Svelte glue is checked by
// its source; the storage rule is checked live.
const floatWindow = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function member(head: string): string {
  const from = state.indexOf(`\n  ${head}`);
  return from < 0 ? '' : state.slice(from, state.indexOf('\n  }\n', from));
}

// A window lying at the sheet's top edge was under the plate in arrange mode
// and could not be picked up to be put back.
describe('в режиме раскладки окна лежат над плашкой', () => {
  test('слой окна — над плашкой раскладки, пока идёт раскладка', () => {
    expect(floatWindow).toMatch(/editor\.arranging \? 'var\(--z-arrange\) \+ 1' : 'var\(--z-float\)'/);
  });
});

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

const KEY = 'toon-editor:ui';

function config(panels: unknown, floatPos: unknown, fill: string): Parameters<typeof saveUiConfig>[0] {
  return {
    preset: 'toonop',
    panels,
    floatPos,
    drawing: { fill },
    settings: {},
  } as unknown as Parameters<typeof saveUiConfig>[0];
}

// Two tabs: the arrangement made in one was overwritten when the other, with
// the old arrangement in memory, saved anything at all — a brush, a setting.
// The owner's rule: the last tab where the arrangement itself changed wins.
describe('расстановку пишет только вкладка, где её меняли', () => {
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

  test('запись без смены расстановки оставляет сохранённую расстановку', () => {
    saveUiConfig(config({ left: ['other-tab'] }, { a: { x: 5, y: 6 } }, 'old'));
    saveUiConfig(config({ left: ['stale'] }, {}, 'new'), false);
    const stored = JSON.parse(store.getItem(KEY) ?? '{}');
    expect(stored.panels).toEqual({ left: ['other-tab'] });
    expect(stored.floatPos).toEqual({ a: { x: 5, y: 6 } });
    // Everything else is this tab's.
    expect(stored.drawing).toEqual({ fill: 'new' });
  });

  test('смена расстановки пишет свою', () => {
    saveUiConfig(config({ left: ['other-tab'] }, {}, 'old'));
    saveUiConfig(config({ left: ['mine'] }, {}, 'new'), true);
    expect(JSON.parse(store.getItem(KEY) ?? '{}').panels).toEqual({ left: ['mine'] });
  });

  test('пустое или испорченное хранилище — пишется своё целиком', () => {
    saveUiConfig(config({ left: ['mine'] }, {}, 'new'), false);
    expect(JSON.parse(store.getItem(KEY) ?? '{}').panels).toEqual({ left: ['mine'] });
    store.setItem(KEY, '{broken');
    saveUiConfig(config({ left: ['mine'] }, {}, 'again'), false);
    expect(JSON.parse(store.getItem(KEY) ?? '{}').drawing).toEqual({ fill: 'again' });
  });

  test('состояние сравнивает расстановку с той, что видело последней', () => {
    const persist = member('private persistUiConfig(): void {');
    expect(persist).toContain('this.layoutSeen');
    expect(persist).toMatch(/saveUiConfig\([^]*, own\)/);
    expect(state).toMatch(/this\.layoutSeen = this\.layoutKey\(\)/);
  });
});
