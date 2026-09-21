import { describe, expect, it } from 'bun:test';
import { SQUARE_STAMP } from '../format/types';
import type { ToolDescriptor } from '../format/types';
import * as profiles from './profiles';
import { pixelPlugin } from '../plugins/pixel';
import { addStroke, createDocument } from '../model/operations';
import { canonicalize } from '../format/canonical';
import { MAX_STROKE_WIDTH } from '../format/constants';
import { loadDocument } from '../format/validate';

const pencil: ToolDescriptor = { kind: 'pencil', dialect: 'multator', width: 32, color: '#123456' };

describe('profile/session contract', () => {
  it('freezes profile and descriptor settings at begin', () => {
    const selected = { profile: 'multator' as const, descriptor: { ...pencil } };
    const session = profiles.beginStrokeSession(selected.profile, sample(1, 10.4, 20.6), selected.descriptor);
    selected.profile = 'multator';
    selected.descriptor.width = 80;
    profiles.appendStrokeEvent(session, sample(1, 30.2, 40.4));
    expect(profiles.commitStrokeSession(session)).toEqual({
      points: [10, 21, 30, 40],
      tool: pencil,
    });
  });

  it('Multator cancel clears a session without producing committed geometry', () => {
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'multator', descriptor: pencil,
    }));
    expect(controller.pointerDown(sample(1, 10, 20))).toBe(true);
    controller.pointerMove(sample(1, 30, 40));
    expect(controller.pointerCancel(sample(1, 30, 40))).toBe(true);
    expect(controller.takeCommitted()).toBeNull();
  });

  it('discard drops a Tonio session whole — a second finger means the stroke never happened', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' };
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'toonio', descriptor, tonio: { smooth: 1, minDistance: 0 },
    }));
    expect(controller.pointerDown(sample(1, 0, 0))).toBe(true);
    controller.pointerMove(sample(1, 16, 0));
    expect(controller.discard()).toBe(true);
    expect(controller.session).toBeNull();
    expect(controller.takeCommitted()).toBeNull();
    expect(controller.discard()).toBe(false);
  });

  it('Tonio cancel commits collected points without appending the cancel event', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' };
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'toonio', descriptor, tonio: { smooth: 1, minDistance: 0 },
    }));
    expect(controller.pointerDown(sample(1, 0, 0))).toBe(true);
    controller.pointerMove(sample(1, 16, 0));
    expect(controller.pointerCancel(sample(1, 40, 0))).toBe(true);
    expect(controller.takeCommitted()).toEqual({
      points: [0, 0, 16, 0, 16, 0, 16, 0],
      tool: descriptor,
    });
  });
});

describe('Tonio Smooth / Prepare golden behavior', () => {
  it('Smooth keeps first, every s-th point, last, and an endpoint sentinel', () => {
    expect(profiles.tonioSmooth([0, 0, 8, 8, 16, 16, 24, 24, 32, 32], 2)).toEqual([
      0, 0, 8, 8, 24, 24, 32, 32, 32, 32,
    ]);
    expect(profiles.tonioSmooth([8, 16], 3)).toEqual([8, 16, 8, 16, 8, 16]);
  });

  it('Prepare uses original adjacent distances, strict > m/zoom, and adds a sentinel', () => {
    expect(profiles.tonioPrepare([0, 0, 16, 0, 40, 0, 40, 0], 2, 1)).toEqual([
      0, 0, 40, 0, 40, 0, 40, 0,
    ]);
    expect(profiles.tonioPrepare([5, 6], 3, 1)).toEqual([5, 6]);
  });

  it('normalizes min-distance from the 1280px Tonio canvas to the 600px editor canvas', () => {
    expect(profiles.tonioPrepare(
      [0, 0, 16, 0, 40, 0, 40, 0],
      3,
      1,
      1280 / 600,
    )).toEqual([0, 0, 16, 0, 40, 0, 40, 0, 40, 0]);
  });

  it('uses the captured Tonio coordinate scale when committing a session', () => {
    const descriptor: ToolDescriptor = { kind: 'eraser', dialect: 'toonio', width: 40 };
    const session = profiles.beginStrokeSession(
      'toonio',
      sample(1, 0, 0),
      descriptor,
      { smooth: 1, minDistance: 3 },
      1280 / 600,
    );
    profiles.appendStrokeEvent(session, sample(1, 16, 0));
    profiles.appendStrokeEvent(session, sample(1, 40, 0));

    expect(profiles.commitStrokeSession(session).points).toEqual([
      0, 0, 16, 0, 40, 0, 40, 0, 40, 0,
    ]);
  });

  it('divides the threshold by the zoom captured at pointerdown (reference m / scale)', () => {
    // m = 3 logical px over a 600px canvas normalised from 1280: at zoom 1 the
    // 16-unit step is dropped, at zoom 4 the threshold is four times smaller
    // and the same step survives.
    const descriptor: ToolDescriptor = { kind: 'eraser', dialect: 'toonio', width: 40 };
    const draw = (zoom: number) => {
      const session = profiles.beginStrokeSession(
        'toonio',
        sample(1, 0, 0),
        descriptor,
        { smooth: 1, minDistance: 3 },
        1,
        zoom,
      );
      profiles.appendStrokeEvent(session, sample(1, 16, 0));
      profiles.appendStrokeEvent(session, sample(1, 40, 0));
      return profiles.commitStrokeSession(session).points;
    };

    expect(draw(1)).toEqual([0, 0, 40, 0, 40, 0]);
    expect(draw(4)).toEqual([0, 0, 16, 0, 40, 0, 40, 0, 40, 0]);
  });

  it('truncates logical coordinates before converting to fixed-point ×8', () => {
    expect(profiles.quantizeTonioPoint(19.9, -19.9)).toEqual([16, -16]);
  });
});

/** The pixel tool's own rules, as the register hands them to the canvas. */
const own = pixelPlugin.tool!.stroke as profiles.OwnCapture;

describe('Tonio feather and pixel sessions', () => {
  it('the feather runs the pencil pipeline and keeps both colors', () => {
    const descriptor: ToolDescriptor = {
      kind: 'feather', dialect: 'toonio', width: 40, color: '#000000', fill: '#ff0000',
    };
    const session = profiles.beginStrokeSession('toonio', sample(1, 0, 0), descriptor, { smooth: 1, minDistance: 0 });
    profiles.appendStrokeEvent(session, sample(1, 40, 0));
    const committed = profiles.commitStrokeSession(session);
    expect(committed.tool).toEqual(descriptor);
    // Same Smooth + Prepare output as a Tonio pencil would give.
    expect(committed.points).toEqual([0, 0, 40, 0, 40, 0, 40, 0]);
  });

  it('a tool that collects its own points snaps them and commits without a sentinel', () => {
    // The pixel tool, wired the way the editor wires it: the engine knows
    // nothing about it, the rules come from the tool itself (plugins/pixel.ts).
    const descriptor: ToolDescriptor = { kind: 'stamp', dialect: 'toonio', width: 16, color: '#0026ff', shape: SQUARE_STAMP };
    const session = profiles.beginStrokeSession(
      'toonio', sample(1, 0, 0), descriptor, undefined, undefined, 1, own,
    );
    profiles.appendStrokeEvent(session, sample(1, 20, 4));
    profiles.appendStrokeEvent(session, sample(1, 64, 0));
    const committed = profiles.commitStrokeSession(session);
    expect(committed.tool).toEqual(descriptor);
    expect(committed.points).toEqual([0, 0, 16, 0, 64, 0]);
  });

  it('its preview shows the points as collected, unsmoothed', () => {
    const descriptor: ToolDescriptor = { kind: 'stamp', dialect: 'toonio', width: 16, color: '#0026ff', shape: SQUARE_STAMP };
    const session = profiles.beginStrokeSession(
      'toonio', sample(1, 0, 0), descriptor, undefined, undefined, 1, own,
    );
    profiles.appendStrokeEvent(session, sample(1, 20, 4));
    expect(profiles.previewStrokeSession(session)).toEqual([0, 0, 16, 0]);
  });
});

describe('Tonio coalesced collection', () => {
  it('filters pointerId, preserves order, removes duplicates, and appends pointerup', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' };
    const session = profiles.beginStrokeSession('toonio', sample(7, 8, 8), descriptor, { smooth: 1, minDistance: 0 });
    profiles.appendStrokeEvent(session, sample(7, 99, 99, [
      sample(7, 16, 16), sample(8, 500, 500), sample(7, 16, 16), sample(7, 24, 24),
    ]));
    profiles.finishStrokeEvent(session, sample(7, 32, 32));
    expect(session.rawPoints).toEqual([8, 8, 16, 16, 24, 24, 32, 32]);
  });

  it('falls back to the event itself when coalesced input is unavailable or empty', () => {
    const descriptor: ToolDescriptor = { kind: 'eraser', dialect: 'toonio', width: 40 };
    const session = profiles.beginStrokeSession('toonio', sample(2, 0, 0), descriptor);
    profiles.appendStrokeEvent(session, sample(2, 8, 8, []));
    expect(session.rawPoints).toEqual([0, 0, 8, 8]);
  });

  it('removes duplicates inside one event batch but preserves a duplicate across batches', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' };
    const session = profiles.beginStrokeSession('toonio', sample(1, 0, 0), descriptor);
    profiles.appendStrokeEvent(session, sample(1, 0, 0));
    profiles.appendStrokeEvent(session, sample(1, 99, 99, [
      sample(1, 8, 8), sample(1, 8, 8), sample(1, 16, 16),
    ]));
    expect(session.rawPoints).toEqual([0, 0, 0, 0, 8, 8, 16, 16]);
  });

  it('uses a non-empty coalesced pointerup batch instead of appending the main event', () => {
    const descriptor: ToolDescriptor = { kind: 'eraser', dialect: 'toonio', width: 40 };
    const session = profiles.beginStrokeSession('toonio', sample(1, 0, 0), descriptor);
    profiles.finishStrokeEvent(session, sample(1, 32, 32, [sample(1, 8, 8), sample(1, 16, 16)]));
    expect(session.rawPoints).toEqual([0, 0, 8, 8, 16, 16]);
  });
});

it('round-trips Multator → Tonio → Multator references in one frame', () => {
  const doc = createDocument();
  for (const [profile, x] of [['multator', 0], ['toonio', 80], ['multator', 160]] as const) {
    const descriptor: ToolDescriptor = { kind: 'pencil', dialect: profile, width: 32, color: '#123456' };
    const session = profiles.beginStrokeSession(profile, sample(1, x, 0), descriptor, { smooth: 1, minDistance: 0 });
    profiles.appendStrokeEvent(session, sample(1, x + 40, 40));
    if (profile === 'toonio') profiles.finishStrokeEvent(session, sample(1, x + 48, 48));
    addStroke(doc, 0, 0, profiles.commitStrokeSession(session));
  }
  const reloaded = loadDocument(JSON.parse(canonicalize(doc)));
  expect(
    reloaded.layers[0].frames[0].strokes.map((stroke) => reloaded.tools[stroke.tool_id].dialect),
  ).toEqual([
    'multator', 'toonio', 'multator',
  ]);
  expect(reloaded).toEqual(doc);
});

function sample(pointerId: number, x: number, y: number, coalesced?: profiles.PointerSample[]): profiles.PointerSample {
  return { pointerId, isPrimary: true, x, y, coalesced };
}

describe('brush width in reference-canvas pixels', () => {
  const scale600 = profiles.TONIO_CANVAS_WIDTH / 600;

  it('each dialect measures its brush on its own reference canvas', () => {
    expect(profiles.canvasCoordinateScale('toonio', 1280)).toBe(1);
    expect(profiles.canvasCoordinateScale('toonio', 600)).toBe(1280 / 600);
    expect(profiles.canvasCoordinateScale('multator', 600)).toBe(1);
    expect(profiles.canvasCoordinateScale('multator', 1280)).toBe(600 / 1280);
  });

  it('a Multator stroke grows with a canvas wider than its own', () => {
    // 4 logical px = 32 doc units on Multator's 600-wide canvas; on 1280 the
    // same stroke has to cover the same share of the picture.
    const session = profiles.beginStrokeSession(
      'multator', sample(1, 0, 0),
      { kind: 'pencil', dialect: 'multator', width: 32, color: '#123456' },
      { smooth: 1, minDistance: 0 }, profiles.canvasCoordinateScale('multator', 1280),
    );
    expect(session.descriptor.width).toBe(68);
  });

  it('never widens a stroke past what the format can hold', () => {
    const session = profiles.beginStrokeSession(
      'multator', sample(1, 0, 0),
      { kind: 'pencil', dialect: 'multator', width: 2400, color: '#123456' },
      { smooth: 1, minDistance: 0 }, profiles.canvasCoordinateScale('multator', 1280),
    );
    expect(session.descriptor.width).toBe(MAX_STROKE_WIDTH);
  });

  it('Tonio divides the frozen width by the canvas normalisation', () => {
    // 5 logical px = 40 doc units on a 600-wide canvas: 40 / (1280 / 600) = 18.75 → 19.
    const session = profiles.beginStrokeSession(
      'toonio', sample(1, 0, 0),
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' },
      { smooth: 1, minDistance: 0 }, scale600,
    );
    expect(session.descriptor.width).toBe(19);
  });

  it('a 1280-wide document keeps the width it was given', () => {
    const session = profiles.beginStrokeSession(
      'toonio', sample(1, 0, 0),
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' },
      { smooth: 1, minDistance: 0 }, 1,
    );
    expect(session.descriptor.width).toBe(40);
  });

  it('Multator keeps its width on the canvas it was drawn for', () => {
    const session = profiles.beginStrokeSession(
      'multator', sample(1, 0, 0),
      { kind: 'pencil', dialect: 'multator', width: 40, color: '#123456' },
      { smooth: 1, minDistance: 0 }, profiles.canvasCoordinateScale('multator', 600),
    );
    expect(session.descriptor.width).toBe(40);
  });

  it('the scaled width never falls below one document unit', () => {
    const session = profiles.beginStrokeSession(
      'toonio', sample(1, 0, 0),
      { kind: 'eraser', dialect: 'toonio', width: 1 },
      { smooth: 1, minDistance: 0 }, 100,
    );
    expect(session.descriptor.width).toBe(1);
  });
});

describe('swapStrokeColours (a stroke drawn with the right button)', () => {
  it('a pencil draws with the fill colour', () => {
    expect(profiles.swapStrokeColours(
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#000000' }, '#ff0000',
    )).toEqual({ kind: 'pencil', dialect: 'toonio', width: 40, color: '#ff0000' });
  });

  it('a feather trades its outline for its own fill', () => {
    expect(profiles.swapStrokeColours(
      { kind: 'feather', dialect: 'toonio', width: 40, color: '#000000', fill: '#ff0000' }, '#00ff00',
    )).toEqual({ kind: 'feather', dialect: 'toonio', width: 40, color: '#ff0000', fill: '#000000' });
  });

  it('an eraser has no colours to trade', () => {
    const eraser = { kind: 'eraser', dialect: 'toonio', width: 40 } as const;
    expect(profiles.swapStrokeColours(eraser, '#ff0000')).toEqual(eraser);
  });
});

describe('the feather under a Multator preset', () => {
  it('draws the Multator way: its dialect and its builder follow the preset', () => {
    // A preset is the algorithm. Tonio invented the feather, but a feather
    // put on a Multator panel is a Multator line that happens to be filled.
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'multator',
      descriptor: { kind: 'feather', dialect: 'toonio', width: 40, color: '#000000', fill: '#ff0000' },
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerMove(sample(1, 80, 40));
    controller.pointerUp(sample(1, 160, 0));
    const stroke = controller.takeCommitted()!;
    expect(stroke.tool).toEqual({
      kind: 'feather', dialect: 'multator', width: 40, color: '#000000', fill: '#ff0000',
    });
  });

  it('measures its width on the Multator canvas there', () => {
    const session = profiles.beginStrokeSession(
      'multator', sample(1, 0, 0),
      { kind: 'feather', dialect: 'toonio', width: 40, color: '#000000', fill: '#ff0000' },
      { smooth: 1, minDistance: 0 }, profiles.canvasCoordinateScale('multator', 600),
    );
    expect(session.descriptor.dialect).toBe('multator');
    expect(session.descriptor.width).toBe(40);
  });

  it('keeps the Tonio dialect under a Tonio preset', () => {
    const session = profiles.beginStrokeSession(
      'toonio', sample(1, 0, 0),
      { kind: 'feather', dialect: 'toonio', width: 40, color: '#000000', fill: '#ff0000' },
    );
    expect(session.descriptor.dialect).toBe('toonio');
  });

});

describe('the pixel tool outside the Tonio preset', () => {
  it('collects grid cells even when the preset draws Multator lines', () => {
    // Toonop keeps the pixel tool but draws its pencil the Multator way. The
    // Multator builder would smooth the cells into an ordinary polyline and
    // commit geometry the pixel renderer cannot draw.
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'multator',
      descriptor: { kind: 'stamp', dialect: 'toonio', width: 16, color: '#000000', shape: SQUARE_STAMP },
      own,
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerMove(sample(1, 20, 4));
    controller.pointerUp(sample(1, 40, 8));
    const stroke = controller.takeCommitted()!;
    expect(stroke.tool).toEqual({ kind: 'stamp', dialect: 'toonio', width: 16, color: '#000000', shape: SQUARE_STAMP });
    // Every committed point sits on the 16-unit grid.
    expect(stroke.points.every((v) => v % 16 === 0)).toBe(true);
  });

  it('measures its cell on the Tonio canvas whatever preset draws it', () => {
    // The scale follows the tool's dialect, not the preset: a pixel cell is
    // a pixel of the 1280-wide canvas wherever the tool is offered.
    const session = profiles.beginStrokeSession(
      'multator', sample(1, 0, 0),
      { kind: 'stamp', dialect: 'toonio', width: 16, color: '#000000', shape: SQUARE_STAMP },
      { smooth: 1, minDistance: 0 }, profiles.canvasCoordinateScale('toonio', 600),
    );
    expect(session.descriptor.width).toBe(8);
  });
});

describe('commit comes from the brush', () => {
  const capsule = (points: readonly number[], descriptor: ToolDescriptor) => ({
    points: [...points],
    tool: { kind: 'contour', dialect: 'multator', color: 'color' in descriptor ? descriptor.color : '#000000' } as ToolDescriptor,
  });

  it('lays down the stroke the tool returns, not the one it drew with', () => {
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'multator',
      descriptor: { kind: 'pencil', dialect: 'multator', width: 64, color: '#ff0000' },
      commit: capsule,
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerMove(sample(1, 800, 0));
    controller.pointerUp(sample(1, 800, 0));
    const stroke = controller.takeCommitted()!;
    expect(stroke.tool).toEqual({ kind: 'contour', dialect: 'multator', color: '#ff0000' });
    // What the brush returned is what lands: the engine neither thins nor
    // reshapes it, so the gesture's own points come through.
    expect(stroke.points.slice(0, 4)).toEqual([0, 0, 800, 0]);
  });

  it('hands the commit the scale of its reference canvas', () => {
    let seen = 0;
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'multator',
      descriptor: { kind: 'pencil', dialect: 'multator', width: 64, color: '#ff0000' },
      coordinateScale: 0.5,
      commit: (points, descriptor, ctx) => {
        seen = ctx.coordinateScale;
        return capsule(points, descriptor);
      },
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
        profile: 'multator',
        descriptor: { kind: 'pencil', dialect: 'multator', width: 64, color: '#ff0000' },
        commit: (points) => ({ points: [...points], tool: { kind: 'sparkle' } as unknown as ToolDescriptor }),
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
  /** A tool collecting its own points, as a plugin may: raw pointer positions. */
  const rawOwn: profiles.OwnCapture = {
    capture: (line, points) => [...line, ...points],
  };

  /** A tool that keeps two points and moves the second one — a straight line. */
  const straightOwn: profiles.OwnCapture = {
    capture: (line, points) => {
      const x = points[points.length - 2];
      const y = points[points.length - 1];
      return line.length >= 2 ? [line[0], line[1], x, y] : [x, y];
    },
  };

  it('ends a Tonio line on its endpoint sentinel, whoever collected the points', () => {
    // A Tonio line is written down with its last point duplicated: the
    // renderer's midpoint chain lands on the midpoint of the last pair, so
    // without it the line stops half a segment short of where the hand let go.
    // The dialect's own commit writes it; a tool collecting its own points
    // cannot be expected to know the convention.
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'toonio', descriptor: { ...pencil, dialect: 'toonio' }, own: straightOwn,
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerMove(sample(1, 200, 100));
    controller.pointerUp(sample(1, 300, 150));

    expect(controller.takeCommitted()?.points).toEqual([0, 0, 300, 150, 300, 150]);
  });

  it('previews a Tonio line the way it will be committed, sentinel and all', () => {
    // What is drawn under the hand and what lands in the frame are the same
    // line: without the sentinel the preview stops half a segment short and
    // jumps to the pointer only on release.
    const session = profiles.beginStrokeSession(
      'toonio', sample(1, 0, 0), { ...pencil, dialect: 'toonio' }, undefined, undefined, 1, straightOwn,
    );
    profiles.appendStrokeEvent(session, sample(1, 300, 150));

    expect(profiles.previewStrokeSession(session)).toEqual([0, 0, 300, 150, 300, 150]);
  });

  it('quantizes a tool\'s own points instead of dropping the stroke', () => {
    // The document stores integers; the dialect's own capture quantizes, and a
    // tool that collects its points itself would otherwise have to know that.
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'toonio', descriptor: pencil, own: rawOwn,
    }));
    controller.pointerDown(sample(1, 10.4, 20.6));
    controller.pointerMove(sample(1, 30.2, 40.9));
    controller.pointerUp(sample(1, 30.2, 40.9));

    const committed = controller.takeCommitted();
    expect(committed).not.toBeNull();
    expect(committed!.points.every((coord) => Number.isInteger(coord))).toBe(true);
  });
});
