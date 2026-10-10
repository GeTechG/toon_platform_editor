import { describe, expect, it } from 'bun:test';
import { FrameCache } from './frame-cache';

// Плеер растеризует кадры заранее и потом только выкладывает готовое. Кэш
// знает, сколько кадров в него влезает и какой рисовать следующим.

const doc = {};
const MB = 1024 * 1024;

describe('кэш кадров плеера', () => {
  it('отдаёт положенный кадр', () => {
    const cache = new FrameCache<string>(8 * MB);
    cache.fit(doc, 100, 100);
    expect(cache.get(3)).toBeUndefined();
    cache.put(3, 'третий');
    expect(cache.get(3)).toBe('третий');
  });

  it('следующий к растеризации — первый неготовый от кадра на экране, по кругу', () => {
    const cache = new FrameCache<string>(8 * MB);
    cache.fit(doc, 100, 100);
    cache.put(2, 'a');
    cache.put(3, 'b');
    expect(cache.next(4, 2)).toBe(0);
    cache.put(0, 'c');
    expect(cache.next(4, 2)).toBe(1);
    cache.put(1, 'd');
    expect(cache.next(4, 2)).toBeNull();
  });

  it('держит не больше бюджета: 1280×720 — 3,5 МБ кадр, в 8 МБ влезает два', () => {
    const cache = new FrameCache<string>(8 * MB);
    cache.fit(doc, 1280, 720);
    expect(cache.put(0, 'a')).toBe(true);
    expect(cache.put(1, 'b')).toBe(true);
    expect(cache.put(2, 'c')).toBe(false);
    expect(cache.get(2)).toBeUndefined();
    expect(cache.next(10, 0)).toBeNull();
  });

  it('доля готового считается от того, что влезет: два кадра из десяти — уже всё', () => {
    const cache = new FrameCache<string>(8 * MB);
    cache.fit(doc, 1280, 720);
    expect(cache.progress(10)).toBe(0);
    cache.put(0, 'a');
    expect(cache.progress(10)).toBe(0.5);
    cache.put(1, 'b');
    expect(cache.progress(10)).toBe(1);
  });

  it('другой документ или другой размер — всё заново', () => {
    const cache = new FrameCache<string>(8 * MB);
    cache.fit(doc, 100, 100);
    cache.put(0, 'a');
    cache.fit(doc, 100, 100);
    expect(cache.get(0)).toBe('a');
    cache.fit(doc, 200, 100);
    expect(cache.get(0)).toBeUndefined();
    cache.put(0, 'a');
    cache.fit({}, 200, 100);
    expect(cache.get(0)).toBeUndefined();
  });
});

describe('плеер показывает готовое', () => {
  it('кадр из кэша выкладывается пикселями, а не рисуется заново', async () => {
    const source = await Bun.file(new URL('./Player.svelte', import.meta.url)).text();
    const draw = source.match(/function draw\(\)[^]*?\n  }\n/)![0];
    expect(draw.indexOf('putImageData(ready')).toBeGreaterThan(-1);
    expect(draw.indexOf('putImageData(ready')).toBeLessThan(draw.indexOf('paint(current'));
  });

  it('кадры растеризуются в битмап листа по правилу холста, страница его растягивает', async () => {
    const source = await Bun.file(new URL('./Player.svelte', import.meta.url)).text();
    expect(source).toContain('sheetRaster(');
    expect(source).toContain('scale: raster.level / FIXED_POINT_SCALE, dpr: 1');
  });

  it('часы не идут, пока кадры не растеризованы, а зритель видит загрузку', async () => {
    const source = await Bun.file(new URL('./Player.svelte', import.meta.url)).text();
    expect(source).toMatch(/if \(!playing \|\| !ready\) \{/);
    expect(source).toContain("t('play.loading'");
    expect(source).toContain('role="status"');
  });
});
