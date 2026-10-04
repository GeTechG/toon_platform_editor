// Twenty-first audit, colour area: at 200 % text the swap disc (44 px on the
// seam) lay over the inner halves of the pencil and feather marks, which sat
// 4 px from the seam and are 32 px there. Measured in Chrome on a 390 px
// phone: disc 233–277, marks 219–251 and 259–291. The marks step away from
// the seam as the text grows; at 100 % they stand where they stood.
import { describe, expect, it } from 'bun:test';

const box = await Bun.file(new URL('./PaletteBox.svelte', import.meta.url)).text();
const rule = (selector: string) => {
  const at = box.indexOf(`${selector} {`);
  return at < 0 ? '' : box.slice(at, box.indexOf('}', at));
};
/** `max(0px, min(calc(Arem - Bpx), calc(100% - Crem - Dpx)))` at a root font size and swatch width. */
const shift = (css: string, prop: string, root: number, width: number): number => {
  const m = css.match(
    new RegExp(`${prop}:\\s*max\\(0px,\\s*min\\(calc\\(([\\d.]+)rem - ([\\d.]+)px\\),\\s*calc\\(100% - ([\\d.]+)rem - ([\\d.]+)px\\)\\)\\)`),
  );
  if (!m) return NaN;
  const [a, b, c, d] = m.slice(1).map(Number);
  return Math.max(0, Math.min(a * root - b, width - c * root - d));
};

describe('двадцать первый аудит: цвет', () => {
  for (const [name, selector, prop] of [
    ['контура', '.mark', 'margin-right'],
    ['заливки', '.big + .big .mark', 'margin-left'],
  ] as const) {
    it(`метка ${name} отходит от шва с ростом текста и не лежит под диском «поменять местами»`, () => {
      const css = rule(selector);
      // 100 %: метка там же, в 4 px от шва.
      expect(shift(css, prop, 16, 112)).toBe(0);
      // Образец 111 px — телефон 390 px при 200 %, самый узкий, где всё помещается.
      for (const root of [24, 32]) {
        // Диск: (1rem + 12px) / 2 от шва; метка начинается в 4 px + сдвиг.
        const disc = (root + 12) / 2;
        const gap = 4 + shift(css, prop, root, 111);
        // Верх метки на 200 % — на высоте центра диска: нужен весь радиус.
        // На 150 % верх метки на 7 px ниже центра.
        expect(gap).toBeGreaterThanOrEqual(root === 32 ? disc : Math.sqrt(disc ** 2 - 7 ** 2) - 1);
        // И не доезжает до «+» в дальнем углу (знак 1rem + 8px в 4 px от края).
        expect(gap + root).toBeLessThanOrEqual(111 - (root + 12));
      }
    });

    it(`метка ${name} не заезжает под «+», когда места на всё нет`, () => {
      // Телефон 320 px при 200 %: образец 76 px — метка остаётся у шва.
      expect(shift(rule(selector), prop, 32, 76)).toBe(0);
    });
  }

  it('метка контура не получает сдвиг метки заливки', () => {
    expect(rule('.big + .big .mark')).toMatch(/margin-right:\s*0/);
  });
});
