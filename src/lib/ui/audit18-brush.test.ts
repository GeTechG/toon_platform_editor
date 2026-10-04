import { afterEach, describe, expect, it } from 'bun:test';
import '../../core-plugin';
import { plugins } from '../plugins';
import { PLUGIN_API } from '../plugins/contract';
import { PointerStrokeController, previewStrokePressure, previewStrokeSession } from '../tools/profiles';
import { defaultBrushOf } from './presets';

// Eighteenth audit, the brush.

/** One pen gesture, pressed harder and harder, with a brush of the register. */
function penGesture(tool: string) {
  const stroke = plugins.tool(tool)!.stroke!;
  const brush = { width: 40, color: '#000000', fill: '#ffffff', smooth: 1, minDistance: 0 };
  const pointer = new PointerStrokeController(() => ({
    descriptor: stroke.descriptor(brush), rules: stroke.rules!(brush)!, zoom: 1,
  }));
  const pen = (x: number, pressure: number) => ({ pointerId: 1, isPrimary: true, x, y: x / 2, pressure });
  pointer.pointerDown(pen(0, 0.1));
  for (let x = 80; x <= 800; x += 80) pointer.pointerMove(pen(x, x / 800));
  const session = pointer.session!;
  const live = previewStrokePressure(session, previewStrokeSession(session));
  pointer.pointerUp(pen(880, 0));
  return { live, landed: pointer.takeCommitted()! };
}

describe('линия под пером — с тем нажимом, с каким ляжет', () => {
  // The old pen draws with a pencil and lands a filled contour, which stores
  // no pressure: under a pen the line under the hand ran from 15 % of the
  // width, and on release a contour of the full width landed in its place.
  it('старое перо ложится контуром — и под рукой нажима нет', () => {
    const { live, landed } = penGesture('oldschool');
    expect(landed.tool.kind).toBe('contour');
    expect(landed.pressure).toBeUndefined();
    expect(live).toBeUndefined();
  });

  it('линия, что хранит нажим, показывает его и под рукой', () => {
    const { live, landed } = penGesture('toonio-brush');
    expect(landed.pressure?.length).toBe(landed.points.length / 2);
    expect(live?.at(-1)).toBeGreaterThan(live![0]);
  });
});

describe('умолчание кисти плагина — внутри её же шкалы', () => {
  // A brush that stops at 20 and starts at 50: the field showed 50 over a
  // track that ends at 20, and the line landed fifty wide — a width the
  // slider cannot reach, kept until the slider was touched.
  const PLUGIN = 'test.audit18-brush';
  afterEach(() => plugins.remove(PLUGIN));

  it('толщина не выходит за range кисти', () => {
    plugins.register({
      id: PLUGIN,
      api: PLUGIN_API,
      tools: {
        'test.a18-brush': {
          label: 'Тонкая', title: 'Тонкая', key: '', icon: '<path />',
          stroke: {
            kind: 'pencil',
            descriptor: ({ width, color }: { width: number; color: string }) => ({ kind: 'pencil', geometry: 'smooth', width, color }),
            rules: () => ({
              range: { min: 4, max: 20 },
              defaults: { width: 50, smooth: 3, minDistance: 3 },
              capture: (_line: readonly number[], batch: readonly number[]) => [...batch],
            }),
          },
        },
      },
    });
    expect(defaultBrushOf('test.a18-brush').width).toBe(20);
  });

  it('умолчания поставочных кистей не сдвинулись', () => {
    expect(defaultBrushOf('toonop-brush').width).toBe(5);
    expect(defaultBrushOf('multator-pencil').width).toBe(9);
  });
});
