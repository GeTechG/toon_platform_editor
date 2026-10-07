import { describe, expect, test } from 'bun:test';
import { columnDraws } from './panels';

// Двадцатый аудит, окна и раскладка. Клей Svelte проверяется по исходнику
// (как в audit11–19-windows), чистые части — вживую.
const shell = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

// Колонка, в которой нечего рисовать, с 19-го аудита не рисуется. Окно над
// холстом — нет: клавиша пипетки, вынесенная в окно под Мультатором, после
// сворачивания палитры (M) — или в раскладке, применённой под другим
// профилем, — оставляла пустую рамку с заголовком «Пипетка» и крестиком.
describe('окно предмета, который профиль не рисует, не рисуется', () => {
  const none = { pipette: false, publish: false, fullscreen: false };

  test('один предмет спрашивается так же, как колонка', () => {
    expect(columnDraws(['tool:pipette'], none)).toBe(false);
    expect(columnDraws(['publish'], none)).toBe(false);
    expect(columnDraws(['tool:pipette'], { ...none, pipette: true })).toBe(true);
    expect(columnDraws(['palette'], none)).toBe(true);
  });

  test('оболочка ставит окно только рисуемому предмету', () => {
    const floats = shell.slice(shell.indexOf('{#each [...panels.float].sort() as id (id)}'));
    const gate = floats.indexOf('{#if draws([id])}');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(floats.indexOf('<FloatWindow'));
  });

  test('колонка и окно спрашивают одно и то же', () => {
    expect(shell).toMatch(/function sideDraws\(id: SideId\): boolean \{\s*return draws\(panels\[id\]\);/);
  });
});
