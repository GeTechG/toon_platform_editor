import { describe, expect, it } from 'bun:test';
import { sheetRaster } from './viewport';

// Кадр собирается в битмап листа: пиксель на пиксель документа — истина,
// одинаковая у всех, на любом экране и зуме. Битмап не крупнее 1080p: лист
// больше берёт целую долю — выше растеризация слишком дорога на любом железе.

const sheet = (w: number, h: number) => ({ width: w * 8, height: h * 8 });

describe('битмап листа', () => {
  it('лист до 1080p — в своих пикселях', () => {
    expect(sheetRaster(sheet(1280, 720))).toEqual({ level: 1, width: 1280, height: 720 });
    expect(sheetRaster(sheet(1920, 1080))).toEqual({ level: 1, width: 1920, height: 1080 });
    expect(sheetRaster(sheet(1080, 1920))).toEqual({ level: 1, width: 1080, height: 1920 });
    // Размер листа — его длинная сторона: 4:3 и квадрат в 1080p тоже целы.
    expect(sheetRaster(sheet(1920, 1440))).toEqual({ level: 1, width: 1920, height: 1440 });
    expect(sheetRaster(sheet(1920, 1920))).toEqual({ level: 1, width: 1920, height: 1920 });
  });

  it('4K — половина: 1920×1080', () => {
    expect(sheetRaster(sheet(3840, 2160))).toEqual({ level: 1 / 2, width: 1920, height: 1080 });
  });

  it('2K — половина: 1280×720, целая доля держит сетку пикселей', () => {
    expect(sheetRaster(sheet(2560, 1440))).toEqual({ level: 1 / 2, width: 1280, height: 720 });
  });

  it('документ мельче пикселя — один пиксель, не пустой холст', () => {
    expect(sheetRaster({ width: 3, height: 20 })).toEqual({ level: 1, width: 1, height: 3 });
  });
});

describe('холст собирает кадр в битмап листа', () => {
  it('сборка идёт в пикселях листа, вид только растягивает готовое', async () => {
    const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
    const draw = source.match(/function draw\(\)[^]*?\n  }\n/)![0];
    const viewport = draw.match(/const viewport = \{[^}]*\}/)![0];
    expect(viewport).toContain('raster.level / FIXED_POINT_SCALE');
    expect(viewport).not.toContain('zoom');
    expect(viewport).not.toContain('pan');
    expect(draw).toContain('sheetRaster(editor.doc)');
    expect(draw).toContain('composer.compose(sheetCtx, raster.width, raster.height');
  });
});
