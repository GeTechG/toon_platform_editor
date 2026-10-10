import { describe, expect, test } from 'bun:test';
import { plugins } from '../plugins';
import { movePanelItem, type PanelLayout } from './panels';
import { movesOf, withMoves } from './panel-moves';
import { presetPanels } from './presets';

// The owner, 2026-10-10: «я бы хотел какой-то override придумать» — what a
// hand changed in an arrangement is kept as moves over the preset's start,
// so everything it did not touch goes on following the start.
void plugins;
const start = (): PanelLayout => presetPanels('toonop');
const shape = (p: PanelLayout) => ({ left: p.left, right: p.right, top: p.top, rows: p.rows, float: [...p.float].sort(), hidden: [...p.hidden].sort() });

describe('an arrangement as moves over its start', () => {
  test('untouched, it is no moves at all', () => {
    expect(movesOf(start(), start())).toEqual([]);
    expect(shape(withMoves(start(), []))).toEqual(shape(start()));
  });

  test('one key moved is one move: where it went and what it stands after', () => {
    const own = movePanelItem(start(), 'settings', 'left', 1);
    expect(movesOf(own, start())).toEqual([{ id: 'settings', slot: 'left', after: 'tool:pencil' }]);
  });

  test('a key put on the shelf, a key swapped within its line, a row made over the others', () => {
    const d = start();
    expect(movesOf(movePanelItem(d, 'manual', 'hidden'), d)).toEqual([{ id: 'manual', slot: 'hidden', after: null }]);
    // One of two neighbours moved, not both: the shorter way to say a swap.
    expect(movesOf(movePanelItem(d, 'tool:eraser', 'left', 0), d)).toHaveLength(1);
    expect(movesOf(movePanelItem(d, 'onion', 'newrow:0'), d)).toEqual([{ id: 'onion', slot: 'row:0', after: null, fresh: true }]);
  });

  test('the moves over the start they were taken from give the arrangement back, exactly — whatever was done to it', () => {
    // A hand at it many times over: every item thrown somewhere, by a fixed dice.
    let seed = 20261010;
    const dice = (n: number): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let round = 0; round < 60; round++) {
      const d = start();
      let own = d;
      const ids = [...d.left, ...d.right, ...d.top, ...d.rows.flat(), ...d.hidden];
      for (let i = 0; i < 1 + dice(12); i++) {
        const slots = ['left', 'right', 'top', 'hidden', 'float', ...own.rows.map((_, r) => `row:${r}`), `newrow:${dice(own.rows.length + 1)}`] as const;
        own = movePanelItem(own, ids[dice(ids.length)], slots[dice(slots.length)] as Parameters<typeof movePanelItem>[2], dice(6));
      }
      expect(shape(withMoves(d, movesOf(own, d)))).toEqual(shape(own));
    }
  });

  test('over a start that has changed since, the moves hold and the rest follows the new start', () => {
    const was = start();
    const own = movePanelItem(movePanelItem(was, 'settings', 'left', 1), 'manual', 'hidden');
    const moves = movesOf(own, was);
    // The preset's start changes: the sound leaves the transport's row for the right column, the tools swap.
    const now: PanelLayout = { ...was, left: ['tool:eraser', ...was.left.filter((id) => id !== 'tool:eraser')], right: [...was.right, 'audio'], rows: was.rows.map((row) => row.filter((id) => id !== 'audio')) };
    const next = withMoves(now, moves);
    expect(next.right).toEqual(now.right);
    expect(next.left).toEqual(['tool:eraser', 'tool:pencil', 'settings', ...now.left.slice(2)]);
    expect(next.hidden).toContain('manual');
    expect(next.rows[0]).not.toContain('audio');
    expect(next.rows[0]).not.toContain('settings');
  });

  test('a move whose neighbour is gone from the line stands at its end; a key the start no longer has is still placed', () => {
    const d = start();
    const next = withMoves(d, [{ id: 'settings', slot: 'left', after: 'no-such-key' }, { id: 'tool:of-a-plugin', slot: 'right', after: null }]);
    expect(next.left.at(-1)).toBe('settings');
    expect(next.right[0]).toBe('tool:of-a-plugin');
    expect(next.rows.flat()).not.toContain('settings');
  });
});
