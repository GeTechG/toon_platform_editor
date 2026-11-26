import { type VramBudget, vboBudgetForTier } from './vram-budget';

/** Passed as a small uniform table in the coverage vertex shader. */
export const MAX_RETAINED_COVERAGE_SLOTS = 64;
const MAX_CANDIDATES = 512;
const BYTES_PER_VERTEX = 3 * Float32Array.BYTES_PER_ELEMENT;

interface RetainedGeometry {
  readonly buffer: WebGLBuffer;
  readonly vertexCount: number;
}

/**
 * The geometry of repeated coverage batches, without their atlas coordinates.
 * A batch earns a buffer on its second draw. Streaming handles new drawings and
 * any allocation that would displace working layer textures.
 */
export class CoverageGeometryCache {
  readonly #entries = new Map<string, RetainedGeometry>();
  readonly #candidates = new Set<string>();
  readonly #ids = new WeakMap<Float32Array, number>();
  #nextId = 0;
  #bytes = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly budget: VramBudget,
    private readonly allocated: () => void,
  ) {}

  take(meshes: readonly Float32Array[]): RetainedGeometry | null {
    const ids = [];
    let vertexCount = 0;
    for (const mesh of meshes) {
      let id = this.#ids.get(mesh);
      if (id === undefined) {
        id = this.#nextId++;
        this.#ids.set(mesh, id);
      }
      ids.push(id);
      vertexCount += mesh.length / 2;
    }
    const bytes = vertexCount * BYTES_PER_VERTEX;
    const batchLimit = vboBudgetForTier(this.budget.budget);
    if (bytes === 0 || bytes > batchLimit) return null;

    const key = `coverage:${ids.join(',')}`;
    const cached = this.#entries.get(key);
    if (cached) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      this.budget.touch(key);
      return cached;
    }
    if (!this.#candidates.has(key)) {
      this.#candidates.add(key);
      if (this.#candidates.size > MAX_CANDIDATES) this.#candidates.delete(this.#candidates.values().next().value!);
      return null;
    }

    const otherBytes = this.budget.retainedBytes - this.#bytes;
    const limit = Math.min(2 * batchLimit, this.budget.headroom - otherBytes);
    if (bytes > limit) return null;
    while (this.#bytes + bytes > limit) this.budget.release(this.#entries.keys().next().value!);

    const gl = this.gl;
    let buffer: WebGLBuffer | null = null;
    if (!this.budget.tryRetain(key, bytes, () => {
      if (!buffer) return;
      gl.deleteBuffer(buffer);
      this.#entries.delete(key);
      this.#bytes -= bytes;
    })) return null;

    this.allocated();
    buffer = gl.createBuffer();
    if (!buffer) {
      this.budget.release(key);
      return null;
    }
    const packed = new Float32Array(vertexCount * 3);
    let offset = 0;
    for (let slot = 0; slot < meshes.length; slot++) {
      const mesh = meshes[slot];
      for (let i = 0; i < mesh.length; i += 2) {
        packed[offset++] = mesh[i];
        packed[offset++] = mesh[i + 1];
        packed[offset++] = slot;
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW);
    const entry = { buffer, vertexCount };
    this.#entries.set(key, entry);
    this.#candidates.delete(key);
    this.#bytes += bytes;
    return entry;
  }
}
