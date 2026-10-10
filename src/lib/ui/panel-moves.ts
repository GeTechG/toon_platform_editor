/**
 * An arrangement as moves over its preset's start (owner, 2026-10-10: «я бы
 * хотел какой-то override придумать»): what a hand changed is written down —
 * this key stands there, after that one — and nothing else. Read back, the
 * moves are made over the start of that day, so every key nobody touched goes
 * on following the preset when its start changes.
 *
 * Pure data + pure functions, so `bun test` covers it; presets.ts stores and
 * reads the moves.
 */

import type { PanelLayout } from './panels';

type MoveSlot = 'left' | 'right' | 'top' | 'float' | 'hidden' | `row:${number}`;

export interface PanelMove {
  readonly id: string;
  /** Where it stands. A row is named by its place in the arrangement the moves were taken from. */
  readonly slot: MoveSlot;
  /** The key it stands after; null: first in its line. Gone from the line, the move stands at the end. */
  readonly after: string | null;
  /** The first key of a row the start does not have: the row is made for it. */
  readonly fresh?: true;
}

const LINES = ['left', 'right', 'top'] as const;
/** Where the order says nothing: a window has its own place, the shelf has none. */
const BAGS = ['float', 'hidden'] as const;

/** The longest run of `own` that stands in `start` in the same order: what nobody moved. */
function stayed(start: readonly string[], own: readonly string[]): Set<string> {
  const a = start.filter((id) => own.includes(id));
  const b = own.filter((id) => start.includes(id));
  // The classic table; a line is a dozen keys.
  const len = a.map(() => b.map(() => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      len[i][j] = a[i] === b[j] ? 1 + (len[i + 1]?.[j + 1] ?? 0) : Math.max(len[i + 1]?.[j] ?? 0, len[i][j + 1] ?? 0);
    }
  }
  const kept = new Set<string>();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      kept.add(a[i]);
      i++;
      j++;
    } else if ((len[i + 1]?.[j] ?? 0) >= (len[i][j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return kept;
}

/** The moves that make `own` out of `start`: none where nobody rearranged. */
export function movesOf(own: PanelLayout, start: PanelLayout): PanelMove[] {
  const moves: PanelMove[] = [];
  const line = (slot: MoveSlot, items: readonly string[], kept: ReadonlySet<string>, fresh = false): void => {
    items.forEach((id, i) => {
      if (!kept.has(id)) {
        moves.push({ id, slot, after: items[i - 1] ?? null, ...(fresh && i === 0 ? { fresh: true as const } : {}) });
      }
    });
  };
  for (const slot of LINES) {
    line(slot, own[slot], stayed(start[slot], own[slot]));
  }
  // Which of the start's rows each row is: the pairing that leaves the most
  // keys where they were — each of the start's rows once, and in the start's
  // order; a row paired with none is new.
  const shared = own.rows.map((row) => start.rows.map((from) => from.filter((id) => row.includes(id)).length));
  const best = own.rows.map(() => start.rows.map(() => 0));
  const at = (i: number, j: number): number => best[i]?.[j] ?? 0;
  for (let i = own.rows.length - 1; i >= 0; i--) {
    for (let j = start.rows.length - 1; j >= 0; j--) {
      best[i][j] = Math.max(at(i + 1, j), at(i, j + 1), shared[i][j] > 0 ? shared[i][j] + at(i + 1, j + 1) : 0);
    }
  }
  for (let i = 0, j = 0; i < own.rows.length; i++) {
    while (j < start.rows.length && at(i, j) === at(i, j + 1) && at(i, j) !== at(i + 1, j)) {
      j++;
    }
    if (j < start.rows.length && shared[i][j] > 0 && at(i, j) === shared[i][j] + at(i + 1, j + 1)) {
      line(`row:${i}`, own.rows[i], stayed(start.rows[j], own.rows[i]));
      j++;
    } else {
      line(`row:${i}`, own.rows[i], new Set(), true);
    }
  }
  for (const slot of BAGS) {
    const kept = new Set(start[slot]);
    moves.push(...own[slot].filter((id) => !kept.has(id)).map((id) => ({ id, slot, after: null })));
  }
  return moves;
}

/** `start` with the moves made over it, in the order they were taken. */
export function withMoves(start: PanelLayout, moves: readonly PanelMove[]): PanelLayout {
  const moved = new Set(moves.map((move) => move.id));
  const rest = (list: readonly string[]): string[] => list.filter((id) => !moved.has(id));
  const next: PanelLayout = {
    left: rest(start.left),
    right: rest(start.right),
    top: rest(start.top),
    // A row every key of which was moved away is not there to count.
    rows: start.rows.map(rest).filter((row) => row.length > 0),
    float: rest(start.float),
    hidden: rest(start.hidden),
  };
  for (const { id, slot, after, fresh } of moves) {
    let into: string[];
    const row = /^row:(\d+)$/.exec(slot);
    if (row) {
      const at = Math.min(Number(row[1]), next.rows.length);
      if (fresh || at === next.rows.length) {
        next.rows.splice(at, 0, []);
      }
      into = next.rows[at];
    } else {
      into = next[slot as Exclude<MoveSlot, `row:${number}`>];
    }
    const anchor = after === null ? -1 : into.indexOf(after);
    into.splice(after === null ? 0 : anchor < 0 ? into.length : anchor + 1, 0, id);
  }
  return next;
}

/** Moves as a file may bring them: anything unreadable is simply not a move. */
export function readMoves(value: unknown): PanelMove[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  return value.flatMap((entry): PanelMove[] => {
    const { id, slot, after, fresh } = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof id !== 'string' || seen.has(id) || typeof slot !== 'string'
      || !/^(left|right|top|float|hidden|row:\d{1,3})$/.test(slot) || (after !== null && typeof after !== 'string')) {
      return [];
    }
    seen.add(id);
    return [{ id, slot: slot as MoveSlot, after, ...(fresh === true ? { fresh: true as const } : {}) }];
  });
}
