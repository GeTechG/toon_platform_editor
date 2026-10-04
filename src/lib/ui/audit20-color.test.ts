// Twentieth audit, colour area: the fill swatch's «+» stood 4 px from the
// seam, under the press box of the swap key that sits on it. Measured in
// Chrome at 1300×800 (the box 225 px wide): the centre of the fill's «+» and
// its top-left quarter answered as «поменять местами» — the key swapped the
// colours instead of keeping the fill. Runes components are asserted as source.
import { describe, expect, it } from 'bun:test';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const box = await read('./PaletteBox.svelte');
const picker = await read('./ColourPicker.svelte');
const rule = (selector: string, from: string) => {
  const at = from.indexOf(`${selector} {`);
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at));
};

describe('двадцатый аудит: цвет', () => {
  it('«+» заливки стоит в дальнем от шва углу: его зона не лежит под зоной «поменять местами»', () => {
    // Образец заливки зеркален образцу контура: метки у шва, «+» по краям.
    const add = rule('.big + .big .add', box);
    expect(add).toMatch(/left:\s*auto/);
    expect(add).toMatch(/right:\s*4px/);
    const mark = rule('.big + .big .mark', box);
    expect(mark).toMatch(/right:\s*auto/);
    expect(mark).toMatch(/left:\s*4px/);
  });

  it('зона «+» лежит в углу своего образца и не выходит на сетку под ним', () => {
    // По центру глифа 44 px свисали на 6 px ниже образца — на верх первой
    // строки сетки, и слева за край коробки.
    const zone = rule('.add::after', box);
    expect(zone).toMatch(/left:\s*-4px/);
    expect(zone).toMatch(/bottom:\s*-4px/);
    expect(zone).toMatch(/top:\s*auto/);
    expect(zone).toMatch(/transform:\s*none/);
    const mirrored = rule('.big + .big .add::after', box);
    expect(mirrored).toMatch(/left:\s*auto/);
    expect(mirrored).toMatch(/right:\s*-4px/);
  });

  it('у «исходного» нет правила наведения, которое ничего не меняет', () => {
    expect(picker).not.toMatch(/\.old:hover/);
  });
});
