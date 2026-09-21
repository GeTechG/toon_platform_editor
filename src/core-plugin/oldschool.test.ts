import { describe, expect, it } from 'bun:test';

import type { LineToolDescriptor } from '../lib/format/types';
import { plugins } from '../lib/plugins';
import { brushOfType } from '../lib/plugins/brush-types';
import corePlugin from '.';

const PENCIL: LineToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 64, color: '#ff0000' };
const ERASER: LineToolDescriptor = { kind: 'eraser', geometry: 'smooth', width: 64 };

function commit(id: string, descriptor: LineToolDescriptor, points: readonly number[]) {
  const stroke = plugins.probeRules(id)?.commit;
  if (!stroke) throw new Error(`${id} commits nothing`);
  return stroke(points, descriptor);
}

describe('the oldschool pen is a brush', () => {
  it('carries the Multator numbers, whatever preset holds it', () => {
    // The reference's own, on the editor's canvas: 1..300 of a 600-wide
    // canvas is 1..640 of ours, and its default 4 is 9.
    expect(plugins.probeRules('oldschool')?.range).toEqual({ min: 1, max: 640 });
    expect(plugins.probeRules('oldschool-eraser')?.defaults?.width).toBe(9);
    expect('canvas' in (plugins.probeRules('oldschool') ?? {})).toBe(false);
  });

  it('thins with the reference tolerance brought to the editor\'s canvas', () => {
    // The reference thins at 5 px of its 600-wide canvas — 32/3 px of ours,
    // 85.3 document units. A zigzag of 80 units is under it and flattens the
    // same way a barely visible one does; on the old 600-px reading of the
    // same document it was over the bar and survived.
    const zigzag = (h: number) => [0, 0, 200, h, 400, 0, 600, h, 800, 0, 1000, h, 1200, 0];
    const flat = commit('oldschool', PENCIL, zigzag(4)).points.length;
    expect(commit('oldschool', PENCIL, zigzag(80)).points).toHaveLength(flat);
  });

  it('is on no preset panel — it is a type of the brush in hand, not a key', () => {
    expect(plugins.tool('oldschool')?.key).toBe('');
    expect(plugins.tool('oldschool')?.offPanel).toBe(true);
  });

  it('commits the line it drew as a filled contour of the pencil colour', () => {
    const stroke = commit('oldschool', PENCIL, [0, 0, 800, 0]);
    expect(stroke.tool).toEqual({ kind: 'contour', geometry: 'smooth', color: '#ff0000' });
    // capsule around the 100 px segment at half width 4 px: 10 points
    expect(stroke.points).toHaveLength(20);
    expect(stroke.points.every(Number.isInteger)).toBe(true);
  });

  it('commits the eraser as a contour-eraser', () => {
    expect(commit('oldschool-eraser', ERASER, [0, 0, 800, 0]).tool)
      .toEqual({ kind: 'contour-eraser', geometry: 'smooth' });
  });

  it('has no twin for the feather — a contour carries no fill', () => {
    // The reference ignored its flag for the feather; here the protection is
    // structural: there is no oldschool feather to pick as a type.
    expect(Object.keys(corePlugin.brushTypes!.old.twins)).toEqual(['pencil', 'eraser']);
    expect(plugins.probeRules('feather')).toBeUndefined();
  });

  it('is the old type of the brush in hand, not a tool of its own', () => {
    expect(brushOfType('pencil', 'old')).toBe('oldschool');
    expect(brushOfType('eraser', 'old')).toBe('oldschool-eraser');
    expect(brushOfType('pencil', 'normal')).toBe('pencil');
  });

  it('leaves a brush with no old form alone, whatever the type says', () => {
    // The feather and the pixel keep drawing their own line: the type is
    // offered where there is something to switch to.
    expect(brushOfType('feather', 'old')).toBe('feather');
    expect(brushOfType('drag', 'old')).toBe('drag');
  });

  it('declares no cut policy, because the contour it commits carries its own', () => {
    // The mega eraser reads the stored descriptor: a `contour` goes whole by
    // itself. It finds a tool's policy by primitive kind, so a second brush of
    // kind `pencil` declaring one would change how every pencil stroke is cut.
    expect(plugins.tools().filter((t) => t.stroke?.kind === 'pencil').map((t) => t.id))
      .toEqual(['pencil', 'toonop-brush', 'multator-pencil', 'oldschool', 'toonio-brush']);
    expect(plugins.tools()
      .filter((t) => t.stroke?.kind === 'pencil' || t.stroke?.kind === 'eraser')
      .filter((t) => t.stroke?.cut !== undefined))
      .toEqual([]);
  });

  it('is as thick as the line that was drawn', () => {
    // The width arrives in document units and lands as it is: a contour that
    // scaled it again would jump thicker the moment the pointer is released,
    // since the live line is drawn at the width itself.
    const left = Math.min(
      ...commit('oldschool', PENCIL, [0, 0, 800, 0]).points.filter((_, i) => i % 2 === 0),
    );
    // Width 64 = 8 document px: radius 4 px, so the cap reaches -32 units.
    expect(left).toBe(-32);
  });
});
