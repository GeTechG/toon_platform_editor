import { describe, expect, it } from 'bun:test';
import type { ToolDescriptor } from '../format/types';
import * as profiles from './profiles';
import { addStroke, createDocument } from '../model/operations';
import { canonicalize } from '../format/canonical';
import { loadDocument } from '../format/validate';

const pencil: ToolDescriptor = { kind: 'pencil', dialect: 'multator', width: 32, color: '#123456' };

describe('oldschool pen (easter egg)', () => {
  it('a Multator session flagged oldschool commits a filled contour descriptor', () => {
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'multator', descriptor: { kind: 'pencil', dialect: 'multator', width: 64, color: '#ff0000' }, oldschool: true,
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerMove(sample(1, 800, 0));
    controller.pointerUp(sample(1, 800, 0));
    const stroke = controller.takeCommitted()!;
    expect(stroke.tool).toEqual({ kind: 'contour', dialect: 'multator', color: '#ff0000' });
    // capsule around the 100 px segment at half width 4 px: 10 points
    expect(stroke.points).toHaveLength(20);
    expect(stroke.points.every(Number.isInteger)).toBe(true);
  });

  it('the oldschool eraser commits a contour-eraser descriptor', () => {
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'multator', descriptor: { kind: 'eraser', dialect: 'multator', width: 64 }, oldschool: true,
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerUp(sample(1, 0, 0));
    expect(controller.takeCommitted()!.tool).toEqual({ kind: 'contour-eraser', dialect: 'multator' });
  });

  it('oldschool is ignored for the Tonio profile', () => {
    const descriptor: ToolDescriptor = { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' };
    const controller = new profiles.PointerStrokeController(() => ({
      profile: 'toonio', descriptor, tonio: { smooth: 1, minDistance: 0 }, oldschool: true,
    }));
    controller.pointerDown(sample(1, 0, 0));
    controller.pointerUp(sample(1, 80, 0));
    expect(controller.takeCommitted()!.tool).toEqual(descriptor);
  });
});

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
        false,
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

  it('the pixel tool snaps to its cell grid and commits without a sentinel', () => {
    const descriptor: ToolDescriptor = { kind: 'pixel', dialect: 'toonio', width: 16, color: '#0026ff' };
    const session = profiles.beginStrokeSession('toonio', sample(1, 0, 0), descriptor);
    profiles.appendStrokeEvent(session, sample(1, 20, 4));
    profiles.appendStrokeEvent(session, sample(1, 64, 0));
    const committed = profiles.commitStrokeSession(session);
    expect(committed.tool).toEqual(descriptor);
    expect(committed.points).toEqual([0, 0, 16, 0, 64, 0]);
  });

  it('the pixel preview shows the cells as collected, unsmoothed', () => {
    const descriptor: ToolDescriptor = { kind: 'pixel', dialect: 'toonio', width: 16, color: '#0026ff' };
    const session = profiles.beginStrokeSession('toonio', sample(1, 0, 0), descriptor);
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
