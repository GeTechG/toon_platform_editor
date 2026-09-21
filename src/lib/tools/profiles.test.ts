import { describe, expect, it } from 'bun:test';
import { SQUARE_STAMP } from '../format/types';
import type { ToolDescriptor } from '../format/types';
import * as profiles from './profiles';
import { MULTATOR_RULES, MULTATOR_CANVAS_WIDTH } from '../plugins/brushes/multator';
import {
  TONIO_CANVAS_WIDTH,
  toonioPrepare,
  toonioRules,
  toonioSmooth,
  truncateToPixel,
} from '../plugins/brushes/toonio';

/** The two brushes a preset may hand the engine, as the tests hold them. */
const multator = MULTATOR_RULES;
const toonio = (smooth = 3, minDistance = 3) => toonioRules({ smooth, minDistance });
import { pixelPlugin } from '../plugins/pixel';
import { addStroke, createDocument } from '../model/operations';
import { canonicalize } from '../format/canonical';
import { MAX_STROKE_WIDTH } from '../format/constants';
import { loadDocument } from '../format/validate';

const pencil: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 32, color: '#123456' };

describe('profile/session contract', () => {
  it('freezes the rules and the descriptor at begin', () => {
    const selected = { rules: multator, descriptor: { ...pencil } };
    const session = profiles.beginStrokeSession(sample(1, 10.4, 20.6), selected.descriptor, selected.rules);
    selected.rules = toonio();
    selected.descriptor.width = 80;
    profiles.appendStrokeEvent(session, sample(1, 30.2, 40.4));
    expect(profiles.commitStrokeSession(session)).toEqual({
      points: [10, 21, 30, 40],
      tool: pencil,
    });
  });

  it('a brush that loses a cancelled gesture leaves nothing committed', () => {
    const controller = new profiles.PointerStrokeController(() => ({
      rules: multator, descriptor: pencil,
    }));
    expect(controller.pointerDown(sample(1, 10, 20))).toBe(true);
    controller.pointerMove(sample(1, 30, 40));
    expect(controller.pointerCancel(sample(1, 30, 40))).toBe(true);
    expect(controller.takeCommitted()).toBeNull();
  });

  it('discard drops a session whole — a second finger means the stroke never happened', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' };
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'toonio', descriptor, rules: toonio(1, 0),
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
      profile: 'toonio', descriptor, rules: toonio(1, 0),
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

describe('the Tonio brush through the engine', () => {
  it('Smooth keeps first, every s-th point, last, and an endpoint sentinel', () => {
    expect(toonioSmooth([0, 0, 8, 8, 16, 16, 24, 24, 32, 32], 2)).toEqual([
      0, 0, 8, 8, 24, 24, 32, 32, 32, 32,
    ]);
    expect(toonioSmooth([8, 16], 3)).toEqual([8, 16, 8, 16, 8, 16]);
  });

  it('Prepare uses original adjacent distances, strict > m/zoom, and adds a sentinel', () => {
    expect(toonioPrepare([0, 0, 16, 0, 40, 0, 40, 0], 2, 1)).toEqual([
      0, 0, 40, 0, 40, 0, 40, 0,
    ]);
    expect(toonioPrepare([5, 6], 3, 1)).toEqual([5, 6]);
  });

  it('normalizes min-distance from the 1280px Tonio canvas to the 600px editor canvas', () => {
    expect(toonioPrepare(
      [0, 0, 16, 0, 40, 0, 40, 0],
      3,
      1,
      1280 / 600,
    )).toEqual([0, 0, 16, 0, 40, 0, 40, 0, 40, 0]);
  });

  it('uses the captured Tonio coordinate scale when committing a session', () => {
    const descriptor: ToolDescriptor = { kind: 'eraser', geometry: 'smooth', width: 40 };
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      descriptor,
      toonio(1, 3),
      1280 / 600,
    );
    profiles.appendStrokeEvent(session, sample(1, 16, 0));
    profiles.appendStrokeEvent(session, sample(1, 40, 0));

    expect(profiles.commitStrokeSession(session).points).toEqual([
      0, 0, 0, 0, 16, 0, 40, 0, 40, 0, 40, 0,
    ]);
  });

  it('divides the threshold by the zoom captured at pointerdown (reference m / scale)', () => {
    // m = 3 logical px over a 600px canvas normalised from 1280: at zoom 1 the
    // 16-unit step is dropped, at zoom 4 the threshold is four times smaller
    // and the same step survives.
    const descriptor: ToolDescriptor = { kind: 'eraser', geometry: 'smooth', width: 40 };
    const draw = (zoom: number) => {
      const session = profiles.beginStrokeSession(sample(1, 0, 0),
        descriptor,
        toonio(1, 3),
        1,
        zoom,
      );
      profiles.appendStrokeEvent(session, sample(1, 16, 0));
      profiles.appendStrokeEvent(session, sample(1, 40, 0));
      return profiles.commitStrokeSession(session).points;
    };

    expect(draw(1)).toEqual([0, 0, 0, 0, 40, 0, 40, 0]);
    expect(draw(4)).toEqual([0, 0, 0, 0, 16, 0, 40, 0, 40, 0, 40, 0]);
  });

  it('truncates logical coordinates before converting to fixed-point ×8', () => {
    expect(truncateToPixel(19.9, -19.9)).toEqual([16, -16]);
  });
});

/** The pixel tool's own rules, as the register hands them to the engine. */
const own = pixelPlugin.tool!.stroke!.rules!()!;

describe('the feather and the pixel through the engine', () => {
  it('the feather runs the pencil pipeline and keeps both colors', () => {
    const descriptor: ToolDescriptor = {
      kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000',
    };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, toonio(1, 0));
    profiles.appendStrokeEvent(session, sample(1, 40, 0));
    const committed = profiles.commitStrokeSession(session);
    expect(committed.tool).toEqual(descriptor);
    // Same Smooth + Prepare output as a Tonio pencil would give.
    expect(committed.points).toEqual([0, 0, 0, 0, 40, 0, 40, 0, 40, 0]);
  });

  it('a tool that collects its own points snaps them and commits without a sentinel', () => {
    // The pixel tool, wired the way the editor wires it: the engine knows
    // nothing about it, the rules come from the tool itself (plugins/pixel.ts).
    const descriptor: ToolDescriptor = { kind: 'stamp', geometry: 'line', width: 16, color: '#0026ff', shape: SQUARE_STAMP };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, own, 1, 1);
    profiles.appendStrokeEvent(session, sample(1, 20, 4));
    profiles.appendStrokeEvent(session, sample(1, 64, 0));
    const committed = profiles.commitStrokeSession(session);
    expect(committed.tool).toEqual(descriptor);
    expect(committed.points).toEqual([0, 0, 16, 0, 64, 0]);
  });

  it('its preview shows the points as collected, unsmoothed', () => {
    const descriptor: ToolDescriptor = { kind: 'stamp', geometry: 'line', width: 16, color: '#0026ff', shape: SQUARE_STAMP };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, own, 1, 1);
    profiles.appendStrokeEvent(session, sample(1, 20, 4));
    expect(profiles.previewStrokeSession(session)).toEqual([0, 0, 16, 0]);
  });
});

describe('how the Tonio brush collects a pointer batch', () => {
  it('filters pointerId, preserves order, removes duplicates, and appends pointerup', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' };
    const session = profiles.beginStrokeSession(sample(7, 8, 8), descriptor, toonio(1, 0));
    profiles.appendStrokeEvent(session, sample(7, 99, 99, [
      sample(7, 16, 16), sample(8, 500, 500), sample(7, 16, 16), sample(7, 24, 24),
    ]));
    profiles.finishStrokeEvent(session, sample(7, 32, 32));
    expect(session.rawPoints).toEqual([8, 8, 16, 16, 24, 24, 32, 32]);
  });

  it('falls back to the event itself when coalesced input is unavailable or empty', () => {
    const descriptor: ToolDescriptor = { kind: 'eraser', geometry: 'smooth', width: 40 };
    const session = profiles.beginStrokeSession(sample(2, 0, 0), descriptor, toonio());
    profiles.appendStrokeEvent(session, sample(2, 8, 8, []));
    expect(session.rawPoints).toEqual([0, 0, 8, 8]);
  });

  it('removes duplicates inside one event batch but preserves a duplicate across batches', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, toonio());
    profiles.appendStrokeEvent(session, sample(1, 0, 0));
    profiles.appendStrokeEvent(session, sample(1, 99, 99, [
      sample(1, 8, 8), sample(1, 8, 8), sample(1, 16, 16),
    ]));
    expect(session.rawPoints).toEqual([0, 0, 0, 0, 8, 8, 16, 16]);
  });

  it('uses a non-empty coalesced pointerup batch instead of appending the main event', () => {
    const descriptor: ToolDescriptor = { kind: 'eraser', geometry: 'smooth', width: 40 };
    const session = profiles.beginStrokeSession(sample(1, 0, 0), descriptor, toonio());
    profiles.finishStrokeEvent(session, sample(1, 32, 32, [sample(1, 8, 8), sample(1, 16, 16)]));
    expect(session.rawPoints).toEqual([0, 0, 8, 8, 16, 16]);
  });
});

it('round-trips Multator → Tonio → Multator strokes in one frame', () => {
  const doc = createDocument();
  for (const [rules, x] of [[multator, 0], [toonio(1, 0), 80], [multator, 160]] as const) {
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

describe('brush width in reference-canvas pixels', () => {
  const scale600 = TONIO_CANVAS_WIDTH / 600;

  it('each dialect measures its brush on its own reference canvas', () => {
    expect(profiles.canvasCoordinateScale(TONIO_CANVAS_WIDTH, 1280)).toBe(1);
    expect(profiles.canvasCoordinateScale(TONIO_CANVAS_WIDTH, 600)).toBe(1280 / 600);
    expect(profiles.canvasCoordinateScale(MULTATOR_CANVAS_WIDTH, 600)).toBe(1);
    expect(profiles.canvasCoordinateScale(MULTATOR_CANVAS_WIDTH, 1280)).toBe(600 / 1280);
  });

  it('a Multator stroke grows with a canvas wider than its own', () => {
    // 4 logical px = 32 doc units on Multator's 600-wide canvas; on 1280 the
    // same stroke has to cover the same share of the picture.
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'pencil', geometry: 'smooth', width: 32, color: '#123456' },
      toonio(1, 0), profiles.canvasCoordinateScale(MULTATOR_CANVAS_WIDTH, 1280),
    );
    expect(session.descriptor.width).toBe(68);
  });

  it('never widens a stroke past what the format can hold', () => {
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'pencil', geometry: 'smooth', width: 2400, color: '#123456' },
      toonio(1, 0), profiles.canvasCoordinateScale(MULTATOR_CANVAS_WIDTH, 1280),
    );
    expect(session.descriptor.width).toBe(MAX_STROKE_WIDTH);
  });

  it('a brush of the wider canvas divides the frozen width by the normalisation', () => {
    // 5 logical px = 40 doc units on a 600-wide canvas: 40 / (1280 / 600) = 18.75 → 19.
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' },
      toonio(1, 0), scale600,
    );
    expect(session.descriptor.width).toBe(19);
  });

  it('a 1280-wide document keeps the width it was given', () => {
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' },
      toonio(1, 0), 1,
    );
    expect(session.descriptor.width).toBe(40);
  });

  it('Multator keeps its width on the canvas it was drawn for', () => {
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#123456' },
      toonio(1, 0), profiles.canvasCoordinateScale(MULTATOR_CANVAS_WIDTH, 600),
    );
    expect(session.descriptor.width).toBe(40);
  });

  it('the scaled width never falls below one document unit', () => {
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'eraser', geometry: 'smooth', width: 1 },
      toonio(1, 0), 100,
    );
    expect(session.descriptor.width).toBe(1);
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

describe('the feather under a Multator preset', () => {
  it('draws the Multator way: its builder follows the preset', () => {
    // A preset is the algorithm. Tonio invented the feather, but a feather
    // put on a Multator panel is a Multator line that happens to be filled.
    const controller = new profiles.PointerStrokeController(() => ({
      rules: multator,
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

  it('measures its width on the Multator canvas there', () => {
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000' },
      multator, profiles.canvasCoordinateScale(MULTATOR_CANVAS_WIDTH, 600),
    );
    expect(session.rules).toBe(multator);
    expect(session.descriptor.width).toBe(40);
  });

  it('runs under the Tonio rules when the Tonio preset holds it', () => {
    const rules = toonio();
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000' },
      rules,
    );
    expect(session.rules).toBe(rules);
    // The descriptor is the brush's and the engine leaves it alone.
    expect(session.descriptor.geometry).toBe('smooth');
  });

});

describe('the pixel tool outside the Tonio preset', () => {
  it('collects grid cells even when the preset draws Multator lines', () => {
    // Toonop keeps the pixel tool but draws its pencil the Multator way. The
    // Multator builder would smooth the cells into an ordinary polyline and
    // commit geometry the pixel renderer cannot draw.
    const controller = new profiles.PointerStrokeController(() => ({
      rules: own,
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

  it('measures its cell on the Tonio canvas whatever preset draws it', () => {
    // The scale follows the tool's own canvas, not the preset's: a cell is a
    // pixel of the 1280-wide canvas wherever the tool is offered.
    const session = profiles.beginStrokeSession(sample(1, 0, 0),
      { kind: 'stamp', geometry: 'line', width: 16, color: '#000000', shape: SQUARE_STAMP },
      own, profiles.canvasCoordinateScale(own.canvas, 600),
    );
    expect(session.descriptor.width).toBe(8);
  });
});

describe('commit comes from the brush', () => {
  const capsule = (points: readonly number[], descriptor: ToolDescriptor) => ({
    points: [...points],
    tool: { kind: 'contour', geometry: 'smooth', color: 'color' in descriptor ? descriptor.color : '#000000' } as ToolDescriptor,
  });

  it('lays down the stroke the tool returns, not the one it drew with', () => {
    const controller = new profiles.PointerStrokeController(() => ({
      rules: { ...multator, commit: capsule },
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

  it('hands the commit the scale of its reference canvas', () => {
    let seen = 0;
    const controller = new profiles.PointerStrokeController(() => ({
      rules: {
        ...multator,
        commit: (points, descriptor, ctx) => {
          seen = ctx.coordinateScale;
          return capsule(points, descriptor);
        },
      },
      descriptor: { kind: 'pencil', geometry: 'smooth', width: 64, color: '#ff0000' },
      coordinateScale: 0.5,
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerUp(sample(1, 0, 0));
    controller.takeCommitted();
    expect(seen).toBe(0.5);
  });

  it('drops a stroke whose commit returned a kind the format does not know', () => {
    const errors: unknown[][] = [];
    const wasError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      const controller = new profiles.PointerStrokeController(() => ({
        rules: {
          ...multator,
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
    canvas: MULTATOR_CANVAS_WIDTH,
    capture: (line, points) => [...line, ...points],
  };

  it('lands exactly what the brush laid down — the engine adds no convention', () => {
    // The endpoint sentinel a Tonio line carries is that brush's own doing,
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
    const rules = toonio(1, 0);
    const session = profiles.beginStrokeSession(sample(1, 0, 0), { ...pencil, geometry: 'smooth' }, rules);
    profiles.appendStrokeEvent(session, sample(1, 300, 150));

    const preview = profiles.previewStrokeSession(session);
    const committed = profiles.commitStrokeSession(session).points;
    // Both went through the brush's own lay-down: the repeated first point is
    // there under the hand too, and both end where the hand is.
    expect(preview.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(committed.slice(0, 4)).toEqual([0, 0, 0, 0]);
    // Truncated to whole logical pixels as the brush collected them.
    expect(preview.slice(-2)).toEqual([296, 144]);
    expect(committed.slice(-2)).toEqual([296, 144]);
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
