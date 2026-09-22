import { describe, expect, it } from 'bun:test';
import { SQUARE_STAMP } from '../format/types';
import type { ToolDescriptor } from '../format/types';
import * as profiles from './profiles';
import { toonopRules } from './brush';
import { simplifyLang } from './simplify';
import { addStroke, createDocument } from '../model/operations';
import { canonicalize } from '../format/canonical';
import { MAX_STROKE_WIDTH } from '../format/constants';
import { loadDocument } from '../format/validate';

const pencil: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 32, color: '#123456' };

/**
 * Two brushes the engine is run with, and a stamp. They are fixtures, not
 * anybody's brush: what is under test here is the engine, which never learns
 * whose rules it is running, so the rules are written out in the test.
 */
/** One point per event, a polyline under the hand, Lang-thinned on commit. */
const coarse: profiles.StrokeRules = {
  capture: (line, batch) =>
    batch.length < 2 ? [...line] : [...line, batch[batch.length - 2], batch[batch.length - 1]],
  prepare: (points) => simplifyLang(points, 5, 80).map(Math.round),
  previewGeometry: 'line',
};
/** The editor's own brush, at the settings a test asks for. */
const fine = (smooth = 3, minDistance = 3) =>
  toonopRules({ width: 0, color: '#000000', fill: '#ffffff', smooth, minDistance });
/** A brush that stamps a mark per cell of its own grid. */
const stamp: profiles.StrokeRules = {
  capture: (line, batch, width) => {
    const out = [...line];
    for (let i = 0; i + 1 < batch.length; i += 2) {
      const x = width * Math.trunc(batch[i] / width);
      const y = width * Math.trunc(batch[i + 1] / width);
      if (!hasCell(out, x, y)) out.push(x, y);
    }
    return out;
  },
  prepare: (points) => [...points],
};

function hasCell(points: readonly number[], x: number, y: number): boolean {
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (points[i] === x && points[i + 1] === y) return true;
  }
  return false;
}

describe('profile/session contract', () => {
  it('freezes the rules and the descriptor at begin', () => {
    const selected = { rules: coarse, descriptor: { ...pencil } };
    const session = profiles.beginStrokeSession(sample(1, 10.4, 20.6), selected.descriptor, selected.rules);
    selected.rules = fine();
    selected.descriptor.width = 80;
    profiles.appendStrokeEvent(session, sample(1, 30.2, 40.4));
    expect(profiles.commitStrokeSession(session)).toEqual({
      points: [10, 21, 30, 40],
      tool: pencil,
    });
  });

  it('a brush that loses a cancelled gesture leaves nothing committed', () => {
    const controller = new profiles.PointerStrokeController(() => ({
      rules: coarse, descriptor: pencil,
    }));
    expect(controller.pointerDown(sample(1, 10, 20))).toBe(true);
    controller.pointerMove(sample(1, 30, 40));
    expect(controller.pointerCancel(sample(1, 30, 40))).toBe(true);
    expect(controller.takeCommitted()).toBeNull();
  });

  it('discard drops a session whole — a second finger means the stroke never happened', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' };
    const controller = new profiles.PointerStrokeController(() => ({
      descriptor, rules: fine(1, 0),
    }));
    expect(controller.pointerDown(sample(1, 0, 0))).toBe(true);
    controller.pointerMove(sample(1, 16, 0));
    expect(controller.discard()).toBe(true);
    expect(controller.session).toBeNull();
    expect(controller.takeCommitted()).toBeNull();
    expect(controller.discard()).toBe(false);
  });

  it('a brush that asked for it lands a cancelled gesture, minus the cancel event', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' };
    const controller = new profiles.PointerStrokeController(() => ({
      descriptor, rules: fine(1, 0),
    }));
    expect(controller.pointerDown(sample(1, 0, 0))).toBe(true);
    controller.pointerMove(sample(1, 16, 0));
    expect(controller.pointerCancel(sample(1, 40, 0))).toBe(true);
    expect(controller.takeCommitted()).toEqual({
      points: [0, 0, 0, 0, 16, 0, 16, 0, 16, 0],
      tool: descriptor,
    });
  });
});

describe('the feather and the pixel through the engine', () => {
  it('the feather runs the pencil pipeline and keeps both colors', () => {
    const descriptor: ToolDescriptor = {
      kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000',
    };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, fine(1, 0));
    profiles.appendStrokeEvent(session, sample(1, 40, 0));
    const committed = profiles.commitStrokeSession(session);
    expect(committed.tool).toEqual(descriptor);
    // Same two thinning stages the editor brush gives.
    expect(committed.points).toEqual([0, 0, 0, 0, 40, 0, 40, 0, 40, 0]);
  });

  it('a tool that collects its own points snaps them and commits without a sentinel', () => {
    // The pixel tool, wired the way the editor wires it: the engine knows
    // nothing about it, the rules come from the tool itself (plugins/pixel.ts).
    const descriptor: ToolDescriptor = { kind: 'stamp', geometry: 'line', width: 16, color: '#0026ff', shape: SQUARE_STAMP };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, stamp, 1);
    profiles.appendStrokeEvent(session, sample(1, 20, 4));
    profiles.appendStrokeEvent(session, sample(1, 64, 0));
    const committed = profiles.commitStrokeSession(session);
    expect(committed.tool).toEqual(descriptor);
    expect(committed.points).toEqual([0, 0, 16, 0, 64, 0]);
  });

  it('its preview shows the points as collected, unsmoothed', () => {
    const descriptor: ToolDescriptor = { kind: 'stamp', geometry: 'line', width: 16, color: '#0026ff', shape: SQUARE_STAMP };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, stamp, 1);
    profiles.appendStrokeEvent(session, sample(1, 20, 4));
    expect(profiles.previewStrokeSession(session)).toEqual([0, 0, 16, 0]);
  });
});

describe('how the editor brush collects a pointer batch', () => {
  it('filters pointerId, preserves order, removes duplicates, and appends pointerup', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' };
    const session = profiles.beginStrokeSession(sample(7, 8, 8), descriptor, fine(1, 0));
    profiles.appendStrokeEvent(session, sample(7, 99, 99, [
      sample(7, 16, 16), sample(8, 500, 500), sample(7, 16, 16), sample(7, 24, 24),
    ]));
    profiles.finishStrokeEvent(session, sample(7, 32, 32));
    expect(session.rawPoints).toEqual([8, 8, 16, 16, 24, 24, 32, 32]);
  });

  it('falls back to the event itself when coalesced input is unavailable or empty', () => {
    const descriptor: ToolDescriptor = { kind: 'eraser', geometry: 'smooth', width: 40 };
    const session = profiles.beginStrokeSession(sample(2, 0, 0), descriptor, fine());
    profiles.appendStrokeEvent(session, sample(2, 8, 8, []));
    expect(session.rawPoints).toEqual([0, 0, 8, 8]);
  });

  it('removes duplicates inside one event batch but preserves a duplicate across batches', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, fine());
    profiles.appendStrokeEvent(session, sample(1, 0, 0));
    profiles.appendStrokeEvent(session, sample(1, 99, 99, [
      sample(1, 8, 8), sample(1, 8, 8), sample(1, 16, 16),
    ]));
    expect(session.rawPoints).toEqual([0, 0, 0, 0, 8, 8, 16, 16]);
  });

  it('uses a non-empty coalesced pointerup batch instead of appending the main event', () => {
    const descriptor: ToolDescriptor = { kind: 'eraser', geometry: 'smooth', width: 40 };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, fine());
    profiles.finishStrokeEvent(session, sample(1, 32, 32, [sample(1, 8, 8), sample(1, 16, 16)]));
    expect(session.rawPoints).toEqual([0, 0, 8, 8, 16, 16]);
  });
});

it('round-trips coarse → fine → coarse strokes in one frame', () => {
  const doc = createDocument();
  for (const [rules, x] of [[coarse, 0], [fine(1, 0), 80], [coarse, 160]] as const) {
    const descriptor: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 32, color: '#123456' };
    const session = profiles.beginStrokeSession(sample(1, x, 0), descriptor, rules);
    profiles.appendStrokeEvent(session, sample(1, x + 40, 40));
    profiles.finishStrokeEvent(session, sample(1, x + 48, 48));
    addStroke(doc, 0, 0, profiles.commitStrokeSession(session));
  }
  const reloaded = loadDocument(JSON.parse(canonicalize(doc)));
  // One descriptor for all three: the document says how the points are read,
  // never which brush laid them down — what differs is the points themselves.
  expect(reloaded.tools).toEqual([{ kind: 'pencil', geometry: 'smooth', width: 32, color: '#123456' }]);
  expect(reloaded.layers[0].frames[0].strokes).toHaveLength(3);
  expect(reloaded).toEqual(doc);
});

function sample(pointerId: number, x: number, y: number, coalesced?: profiles.PointerSample[]): profiles.PointerSample {
  return { pointerId, isPrimary: true, x, y, coalesced };
}

describe('a pixel is a pixel', () => {
  const frozen = (width: number) => profiles.beginStrokeSession(sample(1, 0, 0),
    { kind: 'pencil', geometry: 'smooth', width, color: '#123456' }, fine(1, 0),
  ).descriptor.width;

  it('freezes the width it was given, whatever the document', () => {
    // The document's own size is not in the arithmetic at all: 40 units is
    // 40 units on a 640-wide document and on a 1920-wide one.
    expect(frozen(40)).toBe(40);
    expect(frozen(32)).toBe(32);
    expect(profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' }, fine(1, 0),
    ).descriptor.width).toBe(40);
  });

  it('never lands a stroke wider than the format can hold', () => {
    expect(frozen(MAX_STROKE_WIDTH * 2)).toBe(MAX_STROKE_WIDTH);
  });

  it('never lets a width fall below one document unit', () => {
    expect(profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'eraser', geometry: 'smooth', width: 0 }, fine(1, 0),
    ).descriptor.width).toBe(1);
  });

  it('hands the document scale to nobody: the engine has none', () => {
    expect('documentCoordinateScale' in profiles).toBe(false);
  });
});

describe('swapStrokeColours (a stroke drawn with the right button)', () => {
  it('a pencil draws with the fill colour', () => {
    expect(profiles.swapStrokeColours(
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#000000' }, '#ff0000',
    )).toEqual({ kind: 'pencil', geometry: 'smooth', width: 40, color: '#ff0000' });
  });

  it('a feather trades its outline for its own fill', () => {
    expect(profiles.swapStrokeColours(
      { kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000' }, '#00ff00',
    )).toEqual({ kind: 'feather', geometry: 'smooth', width: 40, color: '#ff0000', fill: '#000000' });
  });

  it('an eraser has no colours to trade', () => {
    const eraser = { kind: 'eraser', geometry: 'smooth', width: 40 } as const;
    expect(profiles.swapStrokeColours(eraser, '#ff0000')).toEqual(eraser);
  });
});

describe('the feather under a coarse brush', () => {
  it('draws that brush\'s way: the feather follows the preset', () => {
    // The brush is the algorithm: a feather under a coarse brush is that
    // brush's line that happens to be filled.
    const controller = new profiles.PointerStrokeController(() => ({
      rules: coarse,
      descriptor: { kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000' },
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerMove(sample(1, 80, 40));
    controller.pointerUp(sample(1, 160, 0));
    const stroke = controller.takeCommitted()!;
    expect(stroke.tool).toEqual({
      kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000',
    });
  });

  it('measures its width the way every other brush does', () => {
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000' },
      coarse,
    );
    expect(session.rules).toBe(coarse);
    expect(session.descriptor.width).toBe(40);
  });

  it('runs under the fine rules when the fine preset holds it', () => {
    const rules = fine();
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000' },
      rules,
    );
    expect(session.rules).toBe(rules);
    // The descriptor is the brush's and the engine leaves it alone.
    expect(session.descriptor.geometry).toBe('smooth');
  });

});

describe('the pixel tool outside the fine preset', () => {
  it('collects grid cells even when the preset draws coarse lines', () => {
    // Toonop keeps the pixel tool but draws its pencil the coarse way. The
    // coarse builder would smooth the cells into an ordinary polyline and
    // commit geometry the pixel renderer cannot draw.
    const controller = new profiles.PointerStrokeController(() => ({
      rules: stamp,
      descriptor: { kind: 'stamp', geometry: 'line', width: 16, color: '#000000', shape: SQUARE_STAMP },
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerMove(sample(1, 20, 4));
    controller.pointerUp(sample(1, 40, 8));
    const stroke = controller.takeCommitted()!;
    expect(stroke.tool).toEqual({ kind: 'stamp', geometry: 'line', width: 16, color: '#000000', shape: SQUARE_STAMP });
    // Every committed point sits on the 16-unit grid.
    expect(stroke.points.every((v) => v % 16 === 0)).toBe(true);
  });

  it('measures its cell the way every other brush does', () => {
    // A cell is the tool's width in document units wherever the tool is
    // offered, and the document's own size does not touch it.
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'stamp', geometry: 'line', width: 16, color: '#000000', shape: SQUARE_STAMP },
      stamp,
    );
    expect(session.descriptor.width).toBe(16);
  });
});

describe('commit comes from the brush', () => {
  const capsule = (points: readonly number[], descriptor: ToolDescriptor) => ({
    points: [...points],
    tool: { kind: 'contour', geometry: 'smooth', color: 'color' in descriptor ? descriptor.color : '#000000' } as ToolDescriptor,
  });

  it('lays down the stroke the tool returns, not the one it drew with', () => {
    const controller = new profiles.PointerStrokeController(() => ({
      rules: { ...coarse, commit: capsule },
      descriptor: { kind: 'pencil', geometry: 'smooth', width: 64, color: '#ff0000' },
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerMove(sample(1, 800, 0));
    controller.pointerUp(sample(1, 800, 0));
    const stroke = controller.takeCommitted()!;
    expect(stroke.tool).toEqual({ kind: 'contour', geometry: 'smooth', color: '#ff0000' });
    // What the brush returned is what lands: the engine neither thins nor
    // reshapes it, so the gesture's own points come through.
    expect(stroke.points.slice(0, 4)).toEqual([0, 0, 800, 0]);
  });

  it('hands the commit the points and the frozen descriptor, and nothing else', () => {
    let seen: unknown[] = [];
    const controller = new profiles.PointerStrokeController(() => ({
      rules: {
        ...coarse,
        commit: (...args) => {
          seen = args;
          return capsule(args[0], args[1]);
        },
      },
      descriptor: { kind: 'pencil', geometry: 'smooth', width: 64, color: '#ff0000' },
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerUp(sample(1, 0, 0));
    controller.takeCommitted();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ kind: 'pencil', geometry: 'smooth', width: 64, color: '#ff0000' });
  });

  it('drops a stroke whose commit returned a kind the format does not know', () => {
    const errors: unknown[][] = [];
    const wasError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      const controller = new profiles.PointerStrokeController(() => ({
        rules: {
          ...coarse,
          commit: (points) => ({ points: [...points], tool: { kind: 'sparkle' } as unknown as ToolDescriptor }),
        },
        descriptor: { kind: 'pencil', geometry: 'smooth', width: 64, color: '#ff0000' },
      }));
      controller.pointerDown(sample(1, 0, 0));
      controller.pointerUp(sample(1, 0, 0));
      expect(controller.takeCommitted()).toBeNull();
    } finally {
      console.error = wasError;
    }
    expect(errors).toHaveLength(1);
    expect(String(errors[0].join(' '))).toContain('sparkle');
  });
});

describe('what reaches the document', () => {
  /** A brush collecting raw pointer positions, as a plugin may. */
  const rawRules: profiles.StrokeRules = {
    capture: (line, points) => [...line, ...points],
  };

  it('lands exactly what the brush laid down — the engine adds no convention', () => {
    // The endpoint sentinel a fine line carries is that brush's own doing,
    // written by its thinning; a brush that collects its own points gets
    // nothing added behind its back.
    const controller = new profiles.PointerStrokeController(() => ({
      rules: rawRules,
      descriptor: { ...pencil, geometry: 'smooth' },
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerMove(sample(1, 200, 100));
    controller.pointerUp(sample(1, 300, 150));

    expect(controller.takeCommitted()?.points).toEqual([0, 0, 200, 100, 300, 150]);
  });

  it('shows under the hand the very line it will store', () => {
    // Preview and commit run the brush's own lay-down, so the line cannot
    // change shape on release.
    const rules = fine(1, 0);
    const session = profiles.beginStrokeSession(sample(1, 0, 0), { ...pencil, geometry: 'smooth' }, rules);
    profiles.appendStrokeEvent(session, sample(1, 300, 150));

    const preview = profiles.previewStrokeSession(session);
    const committed = profiles.commitStrokeSession(session).points;
    // Both went through the brush's own lay-down: the repeated first point is
    // there under the hand too, and both end where the hand is.
    expect(preview.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(committed.slice(0, 4)).toEqual([0, 0, 0, 0]);
    // Rounded to document units as the brush collected them.
    expect(preview.slice(-2)).toEqual([300, 150]);
    expect(committed.slice(-2)).toEqual([300, 150]);
  });

  it('quantizes a brush\'s own points instead of dropping the stroke', () => {
    // The document stores integers; a brush that hands back whatever the
    // pointer gave would otherwise cost the whole stroke to a fraction.
    const controller = new profiles.PointerStrokeController(() => ({
      rules: rawRules,
      descriptor: pencil,
    }));
    controller.pointerDown(sample(1, 10.4, 20.6));
    controller.pointerMove(sample(1, 30.2, 40.9));
    controller.pointerUp(sample(1, 30.2, 40.9));

    const committed = controller.takeCommitted();
    expect(committed).not.toBeNull();
    expect(committed!.points.every((coord) => Number.isInteger(coord))).toBe(true);
  });
});
