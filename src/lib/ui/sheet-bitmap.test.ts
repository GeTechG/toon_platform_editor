import { describe, expect, it } from 'bun:test';
import { sheetBitmap } from './viewport';

// Лист — битмап размера документа: кадр собирается в него один раз, а зум и
// панорама только растягивают готовое. CanvasView — компонент на рунах: чистое
// правило проверяется вызовом, обязанности компонента — по исходнику.

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function block(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет функции ${name}`);
  return match[0];
}

describe('размер битмапа листа', () => {
  it('пиксель на логический пиксель документа', () => {
    expect(sheetBitmap({ width: 10240, height: 5760 })).toEqual({ width: 1280, height: 720 });
  });

  it('вертикальный 4K — 2160×3840', () => {
    expect(sheetBitmap({ width: 17280, height: 30720 })).toEqual({ width: 2160, height: 3840 });
  });

  it('документ мельче пикселя — один пиксель, не пустой холст', () => {
    expect(sheetBitmap({ width: 3, height: 20 })).toEqual({ width: 1, height: 3 });
  });
});

describe('кадр собирается в лист, вид его растягивает', () => {
  it('сборка не знает ни зума, ни панорамы', () => {
    const draw = block('draw');
    expect(draw).toContain('sheetBitmap(editor.doc)');
    const viewport = draw.match(/const viewport = \{[^}]*\}/)![0];
    expect(viewport).not.toContain('zoom');
    expect(viewport).not.toContain('pan');
  });

  it('увеличенный лист выводится без сглаживания, уменьшенный — с ним', () => {
    expect(block('draw')).toMatch(/imageSmoothingEnabled = [^;]*<= /);
  });

  it('смена вида перерисовывает экран, но не трогает сборщик', () => {
    const effects = source.split('$effect(').slice(1).map((body) => body.slice(0, body.indexOf('\n  });')));
    const composing = effects.filter((body) => body.includes('composer.invalidate()'));
    expect(composing.length).toBeGreaterThan(0);
    for (const effect of composing) {
      expect(effect).not.toContain('editor.view');
    }
    expect(source).toMatch(/void editor\.view;\s*\n\s*scheduleDraw\(false\)/);
  });

  it('кадр без правок в листе не собирается заново', () => {
    expect(block('draw')).toMatch(/if \(sheetStale\)/);
  });

  it('снимка на время жеста больше нет', () => {
    expect(source).not.toContain('navShot');
    expect(source).not.toContain('reprojection');
  });

  it('пипетка читает пиксель листа, а не экрана', () => {
    const pick = block('pickColor');
    expect(pick).toContain('toDocUnits(e)');
    expect(pick).not.toContain('pickedPixel');
  });
});
