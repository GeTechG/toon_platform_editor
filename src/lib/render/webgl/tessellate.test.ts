import { describe, expect, it } from 'bun:test';
import {
  GeometryKeeper,
  classifyThinFill,
  countMonotoneYChains,
  minProjectedStrokeWidth,
  tessellateStroke,
  MAX_STENCIL_WINDING,
  SUBPIXEL_THRESHOLD_PX,
} from './tessellate';
import { emitPressuredOutline, flattenPressured } from '../pressure';
import { SQUARE_STAMP, type ToolDescriptor } from '../../format/types';

describe('tessellate.ts geometry authority and guards', () => {
  it('matches emitPressuredOutline exact geometry on the 2-point width=1600 pressure=[0,100] counterexample', () => {
    const tool: ToolDescriptor = { kind: 'pencil', geometry: 'line', width: 1600, color: '#000000' };
    const points = [0, 0, 3200, 0];
    const pressure = [0, 100];
    const mesh = tessellateStroke(points, tool, 1, pressure);
    expect(mesh.mode).toBe('nonzero');
    expect(mesh.fallbackReason).toBeUndefined();
    // Collect reference outline vertex coordinates from emitPressuredOutline at x ~ 3030.
    const flat = flattenPressured(points, pressure, 'line');
    const refPts: number[] = [];
    emitPressuredOutline(flat, 1600, {
      moveTo(x, y) { refPts.push(x, y); },
      lineTo(x, y) { refPts.push(x, y); },
      arc(cx, cy, r, a0, a1, ccw) {
        const steps = 16;
        let sweep = a1 - a0;
        if (ccw && sweep > 0) sweep -= Math.PI * 2;
        if (!ccw && sweep < 0) sweep += Math.PI * 2;
        for (let i = 0; i <= steps; i++) {
          const a = a0 + (sweep * i) / steps;
          refPts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      },
    });
    // Ensure emitted triangles cover the same bbox as emitPressuredOutline (not tangent trapezoids).
    let refMaxY = -Infinity;
    for (let i = 1; i < refPts.length; i += 2) refMaxY = Math.max(refMaxY, refPts[i]);
    expect(Math.abs(mesh.bounds[3] - refMaxY)).toBeLessThan(2);
    // Check that near x = 3030 (on the linear normal side before the right endcap), the upper contour matches linear normal ~763.88, NOT tangent ~781.73.
    let nearY = -Infinity;
    for (let i = 0; i < mesh.fillVertices.length; i += 2) {
      const x = mesh.fillVertices[i];
      const y = mesh.fillVertices[i + 1];
      if (Math.abs(x - 3030) < 250 && y > 0 && x < 3195) {
        nearY = Math.max(nearY, y);
      }
    }
    expect(nearY).toBeLessThan(805);
  });

  it('handles 180-degree pressured reversals and steep pressure jumps without NaN or empty mesh', () => {
    const tool: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 200, color: '#112233' };
    const points = [0, 0, 800, 0, 0, 0];
    const pressure = [10, 100, 10];
    const mesh = tessellateStroke(points, tool, 1, pressure);
    expect(mesh.fillVertices.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < mesh.fillVertices.length; i++) {
      expect(Number.isFinite(mesh.fillVertices[i])).toBe(true);
    }
  });

  it('tessellates smooth and cubic curves within 0.15 sheet-pixel chord error even on long int16 spans', () => {
    const cubic: ToolDescriptor = { kind: 'pencil', geometry: 'cubic', width: 40, color: '#000000' };
    // Long cubic across int16 span that needs > 16 subdivisions for <= 0.15 px error.
    const points = [-10000, 0, -3000, 14000, 3000, -14000, 10000, 0];
    const mesh = tessellateStroke(points, cubic, 1);
    expect(mesh.mode).toBe('union');
    expect(mesh.unionVertices.length).toBeGreaterThan(16 * 12);
  });

  it('tessellates dots, SQUARE_STAMP (union, seamless), custom polygon stamps (nonzero), and feather (interior + outline)', () => {
    const pencil: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 80, color: '#ff0000' };
    const dot = tessellateStroke([100, 100], pencil, 1);
    expect(dot.mode).toBe('union');
    expect(dot.unionVertices.length).toBeGreaterThanOrEqual(24);

    const sqStamp: ToolDescriptor = { kind: 'stamp', geometry: 'line', width: 64, color: '#000000', shape: SQUARE_STAMP };
    const stamped = tessellateStroke([0, 0, 192, 0], sqStamp, 1);
    expect(stamped.mode).toBe('union');
    // Interpolated pixel line fills intermediate squares (at least 4 quads = 4 * 12 floats).
    expect(stamped.unionVertices.length).toBeGreaterThanOrEqual(4 * 12);

    const triStamp: ToolDescriptor = { kind: 'stamp', geometry: 'line', width: 80, color: '#00ff00', shape: [0, 0, 1, 0.5, 0, 1] };
    const triMesh = tessellateStroke([0, 0], triStamp, 1);
    expect(triMesh.mode).toBe('nonzero');
    expect(triMesh.fillVertices.length).toBeGreaterThanOrEqual(6);

    const feather: ToolDescriptor = { kind: 'feather', geometry: 'line', width: 40, color: '#000000', fill: '#ffaa00' };
    const fMesh = tessellateStroke([0, 0, 800, 0, 800, 800, 0, 800], feather, 1);
    expect(fMesh.interiorVertices.length).toBeGreaterThan(0);
    expect(fMesh.unionVertices.length).toBeGreaterThan(0);
  });

  it('flags 256-turn winding-overflow contours for bounded Canvas 2D reference fallback', () => {
    const pts: number[] = [];
    const turns = 260;
    for (let i = 0; i < turns * 4; i++) {
      const a = (i * Math.PI) / 2;
      pts.push(Math.round(500 + Math.cos(a) * 200), Math.round(500 + Math.sin(a) * 200));
    }
    expect(countMonotoneYChains(pts)).toBeGreaterThanOrEqual(MAX_STENCIL_WINDING * 2);
    const contour: ToolDescriptor = { kind: 'contour', geometry: 'line', color: '#000000' };
    const mesh = tessellateStroke(pts, contour, 1);
    expect(mesh.fallbackReason).toBe('winding-overflow');
  });

  it('classifies width=8 pressure=0 (0.15 sheet px) and thin diagonal sliver contours (< 0.5 px) for native Canvas 2D reference mask', () => {
    const pencil: ToolDescriptor = { kind: 'pencil', geometry: 'line', width: 8, color: '#000000' };
    expect(minProjectedStrokeWidth(pencil, 1, [0, 0])).toBeCloseTo(0.15, 3);
    expect(minProjectedStrokeWidth(pencil, 1, [0, 0])).toBeLessThan(SUBPIXEL_THRESHOLD_PX);
    const subMesh = tessellateStroke([80, 80, 800, 80], pencil, 1, [0, 0]);
    expect(subMesh.fallbackReason).toBe('subpixel');

    // Diagonal sliver at sheet level 0.5: [160,161, 1600,1601, 1600,1602, 160,162]
    // ~90x90 px bbox, yet thickness is 1/16 sheet px!
    const sliver = [160, 161, 1600, 1601, 1600, 1602, 160, 162];
    expect(classifyThinFill(sliver, 0.5)).toBe(true);
    const contour: ToolDescriptor = { kind: 'contour', geometry: 'line', color: '#000000' };
    const sliverMesh = tessellateStroke(sliver, contour, 0.5);
    expect(sliverMesh.fallbackReason).toBe('subpixel');

    // A normal solid 80x80 sheet-px square (640x640 doc units) is NOT thin.
    expect(classifyThinFill([0, 0, 640, 0, 640, 640, 0, 640], 1)).toBe(false);
  });

  it('caches meshes in GeometryKeeper keyed by points, pressure, geometry-affecting tool fields, and raster level', () => {
    const keeper = new GeometryKeeper(1024 * 1024);
    const pts = [0, 0, 400, 400];
    const t1: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#111111' };
    const t2: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#ff0000' }; // color does not change geometry!
    const t3: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 80, color: '#111111' }; // width DOES change geometry!

    let builds = 0;
    const m1 = keeper.take(pts, t1, 1, undefined, () => { builds++; return tessellateStroke(pts, t1, 1); });
    const m2 = keeper.take(pts, t2, 1, undefined, () => { builds++; return tessellateStroke(pts, t2, 1); });
    const m3 = keeper.take(pts, t3, 1, undefined, () => { builds++; return tessellateStroke(pts, t3, 1); });
    const m4 = keeper.take(pts, t1, 0.5, undefined, () => { builds++; return tessellateStroke(pts, t1, 0.5); });

    expect(m1).toBe(m2);
    expect(m3).not.toBe(m1);
    expect(m4).not.toBe(m1);
    expect(builds).toBe(3);
  });
});
