import { describe, expect, test } from 'bun:test';

// Sixteenth audit, windows and layout: floating windows, the arrange bar,
// saved arrangements across tabs. The Svelte glue is checked by its source
// (as in audit11–15-windows); the pure parts live in their own tests.
const floatWindow = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function rule(source: string, selector: string): string {
  const from = source.indexOf(`\n  ${selector} {`);
  return from < 0 ? '' : source.slice(from, source.indexOf('\n  }', from));
}
function member(head: string): string {
  const from = state.indexOf(`\n  ${head}`);
  return from < 0 ? '' : state.slice(from, state.indexOf('\n  }\n', from));
}

// An absolute box with `left` and an auto width shrinks to the room left of
// the editor's right edge. A window whose place was past that edge (a phone
// turned, an arrangement from a wider screen, a drop at the edge) was drawn
// squeezed to its narrowest — keys in a column — and the clamp, measuring
// that squeezed width, found it already fitting and never moved it back.
describe('окно у правого края не сжимается в столбик', () => {
  test('ширина окна — по содержимому, а не по месту до края', () => {
    expect(rule(floatWindow, '.float')).toMatch(/\n\s+width: max-content;/);
  });
});

// In arrange mode the bar and the body are inert, so a finger lands on the
// window itself, which let the browser take the swipe as a pan: pointercancel,
// and a window could never be put back into a panel from a tablet.
describe('окно в режиме раскладки берётся пальцем', () => {
  test('ручка окна не отдаёт жест браузеру', () => {
    expect(rule(floatWindow, '.float.handle')).toContain('touch-action: none');
  });
});

// A plugin coming or going cleaned the saved arrangements from the list in
// memory and wrote it back — an arrangement saved in another tab since was
// erased (audit15 fixed the same for save, load and delete).
describe('чистка раскладок после плагинов не стирает раскладки другой вкладки', () => {
  test('чистка начинает с хранилища', () => {
    // The cleaning is a member of its own since the 18th audit (a file load runs it too).
    expect(member('refreshPlugins(): void {')).toContain('this.dropGhostKeys()');
    const clean = member('private dropGhostKeys(): void {');
    expect(clean).toContain('loadWorkspaces(');
    expect(clean.indexOf('loadWorkspaces(')).toBeLessThan(clean.indexOf('saveWorkspaces('));
  });
});

// A layout saved or deleted in another tab did not show in this tab's list
// until this tab saved one itself; picking a stale entry applied what the
// other tab had already replaced.
describe('список раскладок видит другую вкладку', () => {
  test('список перечитывается при входе в режим и по событию хранилища', () => {
    expect(arranger).toContain('loadWorkspaces(');
    expect(arranger).toMatch(/<svelte:window[^>]*onstorage=/);
    expect(arranger).toContain('WORKSPACES_KEY');
  });
});
