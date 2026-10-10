import { describe, expect, it } from 'bun:test';
import { sheetRaster } from './viewport';

// Кадр собирается в битмап листа: пиксель на пиксель документа — истина,
// одинаковая у всех. Экран мельче листа берёт целую долю (½, ⅓, ¼…), а
// приближение — только видимый кусок. `on` — где лист лежит на канве и сколько
// её пикселей приходится на пиксель документа.

const UHD = { width: 3840 * 8, height: 2160 * 8 };
const HD = { width: 1280 * 8, height: 720 * 8 };

describe('битмап листа', () => {
  it('4K на экране 1280×720 при 100 % — треть, а не оригинал', () => {
    expect(sheetRaster(UHD, { x: 0, y: 0, scale: 1 / 3 }, { width: 1280, height: 720 }))
      .toEqual({ level: 1 / 3, x: 0, y: 0, width: 1280, height: 720 });
  });

  it('мельче пикселя листа не рисуется: плотный экран растягивает 1280×720', () => {
    expect(sheetRaster(HD, { x: 0, y: 0, scale: 2 }, { width: 2560, height: 1440 }))
      .toEqual({ level: 1, x: 0, y: 0, width: 1280, height: 720 });
  });

  it('приближенный лист — только видимый кусок, в пикселях листа', () => {
    expect(sheetRaster(UHD, { x: -1000, y: -500, scale: 1 }, { width: 1280, height: 720 }))
      .toEqual({ level: 1, x: 1000, y: 500, width: 1280, height: 720 });
  });

  it('кусок больше двух экранов уступает ступень', () => {
    expect(sheetRaster(UHD, { x: -600, y: -300, scale: 0.6 }, { width: 1280, height: 720 }))
      .toEqual({ level: 1 / 2, x: 500, y: 250, width: 1067, height: 600 });
  });

  it('лист за краем стола — один пиксель, не пустой холст', () => {
    const out = sheetRaster(HD, { x: 5000, y: 0, scale: 1 }, { width: 1280, height: 720 });
    expect([out.width, out.height]).toEqual([1, 720]);
  });
});

describe('холст собирает кадр в битмап листа', () => {
  it('сборка идёт в пикселях листа, вид только растягивает готовое', async () => {
    const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
    const draw = source.match(/function draw\(\)[^]*?\n  }\n/)![0];
    const viewport = draw.match(/const viewport = \{[^}]*\}/)![0];
    expect(viewport).toContain('raster.level / FIXED_POINT_SCALE');
    expect(viewport).not.toContain('zoom');
    expect(draw).toContain('composer.compose(sheetCtx, raster.width, raster.height');
  });
});
