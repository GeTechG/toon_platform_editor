import { describe, expect, it } from 'bun:test';
import '../../core-plugin';
import { plugins } from '../plugins';
import { PointerStrokeController, drawsPressure } from '../tools/profiles';

// Двадцатый аудит, холст. CanvasView — компонент на рунах: чистое правило
// проверяется вызовом, обязанности компонента — по исходнику.

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

/** Жест пером с растущим нажимом, кистью из реестра — пока перо на листе. */
function penSession(tool: string) {
  const stroke = plugins.tool(tool)!.stroke!;
  const brush = { width: 40, color: '#000000', fill: '#ffffff', smooth: 1, minDistance: 0 };
  const pointer = new PointerStrokeController(() => ({
    descriptor: stroke.descriptor(brush), rules: stroke.rules!(brush)!, zoom: 1,
  }));
  const pen = (x: number, pressure: number) => ({ pointerId: 1, isPrimary: true, x, y: x / 2, pressure });
  pointer.pointerDown(pen(0, 0.1));
  for (let x = 80; x <= 800; x += 80) pointer.pointerMove(pen(x, x / 800));
  return pointer.session!;
}

// Линия, что растёт только с конца, дорисовывается по частям: цена кадра не
// растёт с длиной штриха. Перо с нажимом выключало это у любой кисти — и у
// той, что нажим не берёт (старое перо ложится контуром): её линия под рукой
// та же, что под мышью, а перерисовывалась целиком на каждый кадр.
describe('живая линия пера у кисти, что нажим не берёт', () => {
  it('старое перо под пером с нажимом ширину не меняет', () => {
    expect(drawsPressure(penSession('oldschool'))).toBe(false);
  });

  it('кисть, что хранит нажим, меняет', () => {
    expect(drawsPressure(penSession('toonio-brush'))).toBe(true);
  });

  it('холст рисует целиком только линию, что меняет ширину', () => {
    const live = handler('liveLine');
    expect(live).toMatch(/const grows = !drawsPressure\(session\)/);
    expect(live).not.toContain('feelsPressure');
  });
});

