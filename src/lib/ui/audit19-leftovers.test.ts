import { describe, expect, test } from 'bun:test';
import * as panels from './panels';

// Девятнадцатый аудит, остатки сборщика.
const shell = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const key = await Bun.file(new URL('./ToolKey.svelte', import.meta.url)).text();
const player = await Bun.file(new URL('../player/Player.svelte', import.meta.url)).text();

// Все клавиши унесены из левой колонки, а в ней остались предметы, которых
// профиль не рисует (пипетка под Тунио, «Отправить» вне сайта): колонка
// стояла пустой полосой в 8.4rem и отнимала холст.
describe('колонка, в которой нечего рисовать, не рисуется', () => {
  const draws = (panels as Record<string, unknown>).columnDraws as
    (ids: readonly string[], has: { pipette: boolean; publish: boolean; fullscreen: boolean }) => boolean;
  const none = { pipette: false, publish: false, fullscreen: false };

  test('пипетка без клавиши и «Отправить» без сайта — пусто', () => {
    expect(draws(['tool:pipette', 'publish', 'fullscreen'], none)).toBe(false);
    expect(draws([], none)).toBe(false);
  });
  test('любой рисуемый предмет — колонка есть', () => {
    expect(draws(['tool:pipette', 'tool:pencil'], none)).toBe(true);
    expect(draws(['tool:pipette'], { ...none, pipette: true })).toBe(true);
    expect(draws(['publish'], { ...none, publish: true })).toBe(true);
    expect(draws(['save'], none)).toBe(true);
  });
  test('оболочка и клавиша спрашивают одно и то же', () => {
    expect(shell).not.toContain('editor.panels.left.length > 0 ||');
    expect(shell).not.toContain('editor.panels.right.length > 0 ||');
    expect(shell).toContain('if (!sideDraws(id)) return 0;');
    expect(key).toContain('editor.pipetteOffered');
  });
});

describe('значок плеера растёт с текстом', () => {
  test('размер в rem', () => {
    expect(player).not.toContain('width="20"');
    expect(player).toContain('width="1.25rem"');
  });
});
