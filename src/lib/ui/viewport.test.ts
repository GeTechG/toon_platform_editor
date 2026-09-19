import { describe, expect, it } from 'bun:test';
import { IDENTITY_VIEW, clampPan, clampZoom, toDocument, zoomAt, zoomCentredOn } from './viewport';

const SIZE = { width: 200, height: 100 };
const DOC = { width: 4800, height: 2400 };

describe('clampZoom', () => {
  it('snaps to the reference 0.5 step inside 1–10', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(1.7)).toBe(1.5);
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(42)).toBe(10);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('zoomAt', () => {
  it('keeps the document point under the pointer in place', () => {
    const view = zoomAt(IDENTITY_VIEW, 2, 100, 50, SIZE.width, SIZE.height);
    expect(view.zoom).toBe(2);
    expect(view.panX).toBe(-100);
    expect(view.panY).toBe(-50);
    // Same client point, same document point before and after.
    expect(toDocument(100, 50, SIZE, DOC, view)).toEqual(toDocument(100, 50, SIZE, DOC, IDENTITY_VIEW));
  });

  it('zooming back out lands on the identity view', () => {
    const inn = zoomAt(IDENTITY_VIEW, 3, 20, 10, SIZE.width, SIZE.height);
    expect(zoomAt(inn, 1, 20, 10, SIZE.width, SIZE.height)).toEqual(IDENTITY_VIEW);
  });
});

describe('clampPan', () => {
  it('pins the content at zoom 1 — no empty margins', () => {
    expect(clampPan({ zoom: 1, panX: 30, panY: -20 }, SIZE.width, SIZE.height)).toEqual(IDENTITY_VIEW);
  });

  it('keeps the zoomed content covering the viewport', () => {
    // zoom 2 of a 200px viewport: the content is 400px, so panX lives in [-200, 0].
    expect(clampPan({ zoom: 2, panX: 50, panY: 0 }, SIZE.width, SIZE.height).panX).toBe(0);
    expect(clampPan({ zoom: 2, panX: -900, panY: 0 }, SIZE.width, SIZE.height).panX).toBe(-200);
    expect(clampPan({ zoom: 2, panX: -120, panY: -30 }, SIZE.width, SIZE.height)).toEqual({
      zoom: 2,
      panX: -120,
      panY: -30,
    });
  });
});

describe('toDocument', () => {
  it('maps canvas pixels to document units at zoom 1', () => {
    expect(toDocument(0, 0, SIZE, DOC, IDENTITY_VIEW)).toEqual([0, 0]);
    expect(toDocument(200, 100, SIZE, DOC, IDENTITY_VIEW)).toEqual([4800, 2400]);
  });

  it('accounts for zoom and pan', () => {
    // zoom 2, panned by a full viewport: the top-left corner now shows the
    // middle of the document.
    expect(toDocument(0, 0, SIZE, DOC, { zoom: 2, panX: -200, panY: -100 })).toEqual([2400, 1200]);
  });
});

describe('zoomCentredOn', () => {
  const size = { width: 400, height: 200 };

  it('puts the document point under the cursor in the middle of the viewport', () => {
    const view = zoomCentredOn(IDENTITY_VIEW, 2, 100, 50, size.width, size.height);
    // The point sat a quarter in; at zoom 2 the middle is 200 / 100 px away.
    expect(view).toEqual({ zoom: 2, panX: 0, panY: 0 });
    expect(0.25 * size.width * view.zoom + view.panX).toBe(size.width / 2);
    expect(0.25 * size.height * view.zoom + view.panY).toBe(size.height / 2);
  });

  it('centres on a point past the middle by panning', () => {
    const view = zoomCentredOn(IDENTITY_VIEW, 2, 300, 150, size.width, size.height);
    expect(view).toEqual({ zoom: 2, panX: -400, panY: -200 });
  });

  it('never pans past the edge of the zoomed document', () => {
    const view = zoomCentredOn(IDENTITY_VIEW, 1.5, 400, 200, size.width, size.height);
    expect(view.panX).toBe(size.width - size.width * 1.5);
    expect(view.panY).toBe(size.height - size.height * 1.5);
  });

  it('zooming back out to 1 leaves no pan behind', () => {
    const panned = { zoom: 4, panX: -300, panY: -150 };
    expect(zoomCentredOn(panned, 1, 10, 10, size.width, size.height))
      .toEqual({ zoom: 1, panX: 0, panY: 0 });
  });
});
