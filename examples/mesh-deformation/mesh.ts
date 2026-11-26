export interface Grid {
  columns: number;
  rows: number;
  rest: Float32Array;
}

export const MAX_SHEAR = 0.16;
export const MAX_BEND = 0.18;

export interface MeshContour {
  rest: Float32Array;
  indices: Uint16Array;
  weights: Float32Array;
  warped: Float32Array;
}

export function createGrid(columns: number, rows: number): Grid {
  const rest = new Float32Array((columns + 1) * (rows + 1) * 2);
  let offset = 0;
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      rest[offset++] = column / columns;
      rest[offset++] = row / rows;
    }
  }
  return { columns, rows, rest };
}

export function moveGrid(grid: Grid, into: Float32Array, shear: number, bend: number): void {
  for (let index = 0; index < grid.rest.length; index += 2) {
    const x = grid.rest[index];
    const y = grid.rest[index + 1];
    const dx = 2 * x - 1;
    const dy = 2 * y - 1;
    into[index] = x + shear * (1 - dx * dx) * dy;
    into[index + 1] = y + bend * (1 - dy * dy) * dx * (1 - 0.6 * dx * dx);
  }
}

function gridCrossings(a: number, b: number, into: number[]): void {
  for (let line = Math.floor(Math.min(a, b)) + 1; line < Math.max(a, b); line++) {
    const fraction = (line - a) / (b - a);
    if (fraction > 1e-8 && fraction < 1 - 1e-8) into.push(fraction);
  }
}

/** Insert the intersections with each triangle edge before either renderer deforms the path. */
export function bindContour(grid: Grid, points: readonly number[]): MeshContour {
  const rest: number[] = [];
  const indices: number[] = [];
  const weights: number[] = [];
  const stride = grid.columns + 1;

  function bind(u: number, v: number): void {
    rest.push(u / grid.columns, v / grid.rows);
    const column = Math.max(0, Math.min(grid.columns - 1, Math.floor(u)));
    const row = Math.max(0, Math.min(grid.rows - 1, Math.floor(v)));
    const x = u - column;
    const y = v - row;
    const topLeft = row * stride + column;
    const bottomRight = topLeft + stride + 1;

    if (x >= y) {
      indices.push(topLeft, topLeft + 1, bottomRight);
      weights.push(1 - x, x - y, y);
    } else {
      indices.push(topLeft, bottomRight, topLeft + stride);
      weights.push(1 - y, x, y - x);
    }
  }

  for (let i = 0; i < points.length; i += 2) {
    const next = (i + 2) % points.length;
    const u = points[i] * grid.columns;
    const v = points[i + 1] * grid.rows;
    const endU = points[next] * grid.columns;
    const endV = points[next + 1] * grid.rows;
    bind(u, v);

    const crossings: number[] = [];
    gridCrossings(u, endU, crossings);
    gridCrossings(v, endV, crossings);
    gridCrossings(u - v, endU - endV, crossings);
    crossings.sort((left, right) => left - right);
    let previous = 0;
    for (const fraction of crossings) {
      if (fraction - previous < 1e-8) continue;
      bind(u + (endU - u) * fraction, v + (endV - v) * fraction);
      previous = fraction;
    }
  }

  return {
    rest: new Float32Array(rest),
    indices: new Uint16Array(indices),
    weights: new Float32Array(weights),
    warped: new Float32Array(rest.length),
  };
}

export function warpContour(contour: MeshContour, gridVertices: Float32Array): Float32Array {
  const { indices, weights, warped } = contour;
  for (let wi = 0, pi = 0; wi < weights.length; wi += 3, pi += 2) {
    const a = indices[wi] * 2;
    const b = indices[wi + 1] * 2;
    const c = indices[wi + 2] * 2;
    const wa = weights[wi];
    const wb = weights[wi + 1];
    const wc = weights[wi + 2];
    warped[pi] = gridVertices[a] * wa + gridVertices[b] * wb + gridVertices[c] * wc;
    warped[pi + 1] = gridVertices[a + 1] * wa + gridVertices[b + 1] * wb + gridVertices[c + 1] * wc;
  }
  return warped;
}
