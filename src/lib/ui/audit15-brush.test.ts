import { afterEach, describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { PLUGIN_API } from '../plugins/contract';
import { brushOfType, brushTypesFor, hasBrushTypes } from '../plugins/brush-types';
import { defaultBrushOf, widthRange } from './presets';
import { brushCeiling, nudgeBrushSize, TOONOP_UX } from './ux-profile';

// Fifteenth audit, the brush.
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();
const sizes = await Bun.file(new URL('./BrushSizes.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

const PLUGIN = 'test.audit15-brush';
afterEach(() => plugins.remove(PLUGIN));

/** A plugin brush whose rules hand back whatever numbers it likes. */
function brushWith(rules: Record<string, unknown>): string {
  plugins.register({
    id: PLUGIN,
    api: PLUGIN_API,
    tools: {
      'test.a15-brush': {
        label: 'Кривая', title: 'Кривая', key: '', icon: '<path />',
        stroke: {
          kind: 'pencil',
          rules: () => ({ capture: (_l: readonly number[], batch: readonly number[]) => [...batch], ...rules }),
          descriptor: ({ width, color }: { width: number; color: string }) =>
            ({ kind: 'pencil', geometry: 'smooth', width, color }),
        },
      },
    },
  });
  return 'test.a15-brush';
}

describe('числа кисти плагина проходят рамки, как числа из настроек', () => {
  // `defaults` плагина шли в запись кисти как есть: ширина −3 или «толсто»,
  // сглаживание 1e9 — линия нулевой толщины, NaN в поле, ползунок за краем.
  it('умолчания плагина — целые и в своих шкалах', () => {
    const id = brushWith({ defaults: { width: -3, smooth: 1e9, minDistance: 'x' } });
    expect(defaultBrushOf(id)).toEqual({ width: 1, smooth: 100, minDistance: 3 });
  });

  it('умолчания не объектом — берутся умолчания редактора', () => {
    const id = brushWith({ defaults: 7 });
    expect(defaultBrushOf(id)).toEqual({ width: 4, smooth: 3, minDistance: 3 });
  });
});

describe('шкала толщины не ломается о чужие числа', () => {
  // `range` правил и `brushSizeMax` пресета плагина не проверялись: NaN делал
  // сеттер толщины немым (editBrush отбрасывает NaN), min > max ставил ползунок
  // и рейку наизнанку, 0 давал линию нулевой толщины.
  it('держит min ≤ max внутри формата и под потолком пресета', () => {
    expect(widthRange({ min: 1, max: 640 }, 500)).toEqual({ min: 1, max: 500 });
    expect(widthRange({ min: 1, max: 20 }, 500)).toEqual({ min: 1, max: 20 });
    expect(widthRange({ min: 50, max: 10 }, 500)).toEqual({ min: 10, max: 10 });
    expect(widthRange({ min: NaN, max: NaN }, 500)).toEqual({ min: 1, max: 500 });
    expect(widthRange({ min: 0, max: 1e6 }, 640)).toEqual({ min: 1, max: 640 });
    expect(widthRange(undefined, 500)).toEqual({ min: 1, max: 500 });
    expect(widthRange({ min: 2.4, max: 30.6 }, 500)).toEqual({ min: 2, max: 31 });
  });

  it('потолок пресета — целый и внутри формата', () => {
    expect(brushCeiling(TOONOP_UX)).toBe(500);
    expect(brushCeiling({ ...TOONOP_UX, brushSizeMax: NaN })).toBe(500);
    expect(brushCeiling({ ...TOONOP_UX, brushSizeMax: 0 })).toBe(1);
    expect(brushCeiling({ ...TOONOP_UX, brushSizeMax: 9000 })).toBe(640);
    expect(nudgeBrushSize(9, 1, { ...TOONOP_UX, brushSizeMax: NaN })).toBe(10);
  });

  it('состояние читает шкалу и потолок через эти проверки', () => {
    expect(member(state, 'get brushRange')).toContain('widthRange(');
    expect(member(state, 'get brush')).toContain('brushCeiling(');
    expect(member(state, 'get brushSizeMax')).toContain('this.brushRange.max');
  });
});

describe('тип кисти не подменяет инструмент тем, чего нет', () => {
  // Двойник на инструмент, которого нет в реестре (его плагин не пришёл или
  // сломан), или не строка: brushTool становился им, холст брал PENCIL — и
  // ластик рисовал чернилами, а список предлагал тип, который ничего не делает.
  it('двойник-призрак — рисует сам инструмент, и в списке его нет', () => {
    plugins.register({
      id: PLUGIN,
      api: PLUGIN_API,
      brushTypes: {
        'test.a15-ghost': { label: 'Призрак', twins: { eraser: 'test.nowhere', feather: 42 } },
      },
    });
    expect(brushOfType('eraser', 'test.a15-ghost')).toBe('eraser');
    expect(brushOfType('feather', 'test.a15-ghost')).toBe('feather');
    expect(brushTypesFor('eraser').map(({ id }) => id)).not.toContain('test.a15-ghost');
    expect(hasBrushTypes('feather')).toBe(false);
  });
});

describe('подсказка заголовка закрывается нажатием мимо', () => {
  // Safari не фокусирует кнопку по касанию: blur не приходит, и открытая
  // подсказка лежала поверх ползунка, пока «i» не нажмут снова.
  it('нажатие вне «i» закрывает подсказку', () => {
    expect(member(panel, 'function pressedElsewhere')).toMatch(/openNote = null/);
  });
});

describe('ряд точек предлагает только достижимые толщины', () => {
  // Кисть плагина со шкалой до 20: точки 21 и 43 давали 20, и ни одна точка
  // не становилась нажатой.
  it('точки за шкалой кисти не показываются', () => {
    expect(sizes).toMatch(/editor\.brushRange\.min/);
    expect(sizes).toMatch(/editor\.brushSizeMax/);
  });
});
