import { describe, expect, test } from 'bun:test';
import { importWorkspaces, parseWorkspaces } from './workspaces';
import { defaultPanels } from './panels';

// Seventeenth audit, windows and layout: floating windows, the arrange bar,
// saved arrangements across tabs. The Svelte glue is checked by its source
// (as in audit11–16-windows); the pure parts are run for real.
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).json();

function member(head: string): string {
  const from = state.indexOf(`\n  ${head}`);
  return from < 0 ? '' : state.slice(from, state.indexOf('\n  }\n', from));
}

// Pressing a window that is not in front raises it, which reorders
// `panels.float` — and the tab counted that as rearranging: its stale copy of
// the panels overwrote the arrangement another tab had really made (owner,
// 16th audit: only a tab where the panels were moved writes them). Which
// window is in front is nobody's work (samePanels says so already).
describe('поднять окно — не переставить панели', () => {
  test('ключ расстановки не зависит от порядка окон', () => {
    const body = member('private layoutKey(): string {');
    expect(body).toContain('.float].sort()');
    expect(body).toMatch(/Object\.entries\(this\.floatingPos\(\)\)\.sort\(\)/);
  });
});

// In arrange mode a folded column is still a drop target (a 4rem strip), but
// draws nothing: an item dropped there vanished, as if it were put away.
describe('брошенное в свёрнутую колонку разворачивает её', () => {
  test('перенос в панель разворачивает панель, как «вернуть в панель»', () => {
    expect(member('movePanelItem(id: string, slot: PanelSlot, index?: number): void {')).toContain('this.unfoldAt(id)');
    expect(member('showPanelItem(id: string): void {')).toContain('this.unfoldAt(id)');
    const unfold = member('private unfoldAt(id: string): void {');
    expect(unfold).toContain("this.sides[at.slot].collapsed = false");
    // A window or the shelf is no panel to open.
    expect(unfold).toMatch(/slotRow\(at\.slot\)/);
  });
});

// A file with the same name twice counted both («пришло раскладок: 2») and
// asked about the name twice, though one replaced the other.
describe('одно имя в файле — одна раскладка', () => {
  const panels = defaultPanels();
  const raw = JSON.stringify([
    { id: 1, name: 'Стол', panels, floatPos: {} },
    { id: 2, name: 'Стол ', panels, floatPos: {} },
  ]);
  test('повтор имени отбрасывается', () => {
    expect(parseWorkspaces(raw).map((w) => w.name)).toEqual(['Стол']);
  });
  test('и не считается пришедшим', () => {
    expect(importWorkspaces([], raw).loaded).toBe(1);
  });
});

// In forced colours the chips on the shelf and the ghost under the hand lose
// their fill and stood as bare words: nothing said they can be picked up.
describe('полка и призрак видны в принудительных цветах', () => {
  test('у фишки и призрака есть рамка', () => {
    const forced = arranger.slice(arranger.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/\.chip,\s*\.ghost\s*\{[^}]*CanvasText/);
  });
});

// An arrangement exported unnamed is called «Текущее», and loaded back it
// sits in the list of «раскладки» with the wrong gender.
describe('безымянная раскладка названа в роде раскладки', () => {
  test('«Текущая»', () => {
    expect(ru.workspace.current).toBe('Текущая');
  });
});
