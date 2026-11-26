import { percentile } from '../../src/bench/metrics';
import { unpackDocument } from '../../src/lib/format/pack';
import type { ToonDocument } from '../../src/lib/format/types';
import { loadDocument } from '../../src/lib/format/validate';
import { bindContour, createGrid, MAX_BEND, MAX_SHEAR, moveGrid } from './mesh';
import { measureDrawing, type Result } from './measurement';
import { createWebGL, drawCanvas, type BoundPaint } from './render';
import { fallbackDocument, HEIGHT, readDrawing, WIDTH, type Paint } from './scene';

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const controls = element<HTMLFieldSetElement>('controls');
const play = element<HTMLButtonElement>('play');
const phase = element<HTMLInputElement>('phase');
const density = element<HTMLSelectElement>('density');
const scope = element<HTMLSelectElement>('scope');
const showGrid = element<HTMLInputElement>('show-grid');
const measure = element<HTMLButtonElement>('measure');
const file = element<HTMLInputElement>('file');
const frame = element<HTMLInputElement>('frame');
const notice = element('notice');
const source = element('source');
const status = element('run-status');
const canvas = element<HTMLCanvasElement>('canvas2d');
const webgl = element<HTMLCanvasElement>('webgl2');
const gridCanvases = [...document.querySelectorAll<HTMLCanvasElement>('.grid')];
for (const surface of [canvas, webgl, ...gridCanvases]) {
  surface.width = WIDTH;
  surface.height = HEIGHT;
}
const ctx = canvas.getContext('2d')!;
const overlays = gridCanvases.map((surface) => surface.getContext('2d')!);

let gpu: ReturnType<typeof createWebGL> | null = null;
try {
  gpu = createWebGL(webgl);
  element('renderer').textContent = gpu.renderer;
} catch (error) {
  renderNotice(error);
}

let doc: ToonDocument;
let paints: Paint[] = [];
let bound: BoundPaint[] = [];
let grid = createGrid(8, 6);
let moved = new Float32Array(grid.rest.length);
let preview = 0;
let measuring = false;
let loading = false;
let loadVersion = 0;
let canvasFirst = true;
let workload = { strokes: 0, sourcePoints: 0, vertices: 0, prepareMs: 0, uploadMs: 0 };

function renderNotice(error: unknown): void {
  notice.textContent = error instanceof Error ? error.message : String(error);
  notice.hidden = false;
}

function motion(angle: number): [number, number] {
  return [MAX_SHEAR * Math.sin(angle), MAX_BEND * Math.sin(2 * angle)];
}

function drawGrid(overlay: CanvasRenderingContext2D): void {
  overlay.clearRect(0, 0, WIDTH, HEIGHT);
  if (!showGrid.checked) return;
  overlay.lineWidth = 1;
  overlay.strokeStyle = 'rgba(19, 75, 214, 0.31)';
  overlay.beginPath();
  const stride = grid.columns + 1;
  const edge = (a: number, b: number) => {
    overlay.moveTo(moved[a * 2] * WIDTH, moved[a * 2 + 1] * HEIGHT);
    overlay.lineTo(moved[b * 2] * WIDTH, moved[b * 2 + 1] * HEIGHT);
  };
  for (let row = 0; row <= grid.rows; row++) {
    for (let column = 0; column <= grid.columns; column++) {
      const index = row * stride + column;
      if (column < grid.columns) edge(index, index + 1);
      if (row < grid.rows) edge(index, index + stride);
      if (column < grid.columns && row < grid.rows) edge(index, index + stride + 1);
    }
  }
  overlay.stroke();
}

function renderPreview(angle = Number(phase.value) * Math.PI / 180): void {
  const [shear, bend] = motion(angle);
  moveGrid(grid, moved, shear, bend);
  drawCanvas(ctx, bound, moved);
  gpu?.draw(shear, bend);
  for (const overlay of overlays) drawGrid(overlay);
}

function stopPreview(): void {
  cancelAnimationFrame(preview);
  preview = 0;
  play.textContent = 'Воспроизвести';
}

function resetMetrics(): void {
  for (const cell of document.querySelectorAll('tbody td')) cell.textContent = '—';
  status.textContent = 'Замер запускает рендереры по очереди.';
  window.meshBenchmark = undefined;
}

function prepare(): void {
  stopPreview();
  const started = performance.now();
  const columns = Number(density.value);
  grid = createGrid(columns, columns * 3 / 4);
  moved = new Float32Array(grid.rest.length);
  const selected = scope.value === 'all' ? paints : paints.slice(0, Number(scope.value));
  bound = selected.map(({ contours, ...paint }) => ({
    ...paint,
    contours: contours.map((contour) => bindContour(grid, contour)),
  }));
  const prepareMs = performance.now() - started;
  const uploadStart = performance.now();
  try {
    gpu?.upload(grid, bound);
  } catch (error) {
    renderNotice(error);
    gpu = null;
  }
  workload = {
    strokes: bound.length,
    sourcePoints: bound.reduce((sum, paint) => sum + paint.pointCount, 0),
    vertices: bound.reduce((total, paint) =>
      total + paint.contours.reduce((sum, contour) => sum + contour.rest.length / 2, 0), 0),
    prepareMs,
    uploadMs: gpu ? performance.now() - uploadStart : 0,
  };
  element('workload').textContent = `${workload.strokes.toLocaleString('ru')} штрихов · ${workload.sourcePoints.toLocaleString('ru')} исходных точек · ${workload.vertices.toLocaleString('ru')} вершин · ${WIDTH} × ${HEIGHT}`;
  element('scope-label').hidden = paints.length <= 250;
  resetMetrics();
  renderPreview();
}

function updateControls(): void {
  controls.disabled = measure.disabled = measuring || loading || paints.length === 0;
  file.disabled = measuring;
  frame.disabled = measuring || loading;
}

function useFrame(index: number): void {
  frame.value = String(index + 1);
  try {
    paints = readDrawing(doc, index);
    if (gpu) notice.hidden = true;
  } catch (error) {
    paints = [];
    renderNotice(error);
  }
  scope.value = 'all';
  prepare();
  updateControls();
}

function useDocument(next: ToonDocument, label: string | HTMLAnchorElement): void {
  doc = next;
  frame.max = String(next.layers[0].frames.length);
  element('frame-label').hidden = Number(frame.max) === 1;
  source.replaceChildren(label);
  useFrame(0);
}

play.addEventListener('click', () => {
  if (preview) {
    stopPreview();
    return;
  }
  const start = performance.now();
  const initial = Number(phase.value);
  play.textContent = 'Пауза';
  function tick(now: number): void {
    phase.value = String(Math.floor((initial + (now - start) * 0.08) % 360));
    renderPreview();
    preview = requestAnimationFrame(tick);
  }
  preview = requestAnimationFrame(tick);
});
phase.addEventListener('input', () => {
  stopPreview();
  renderPreview();
});
showGrid.addEventListener('change', () => renderPreview());
density.addEventListener('change', prepare);
scope.addEventListener('change', prepare);

file.addEventListener('change', async () => {
  const picked = file.files?.[0];
  if (!picked || measuring) return;
  const version = ++loadVersion;
  loading = true;
  updateControls();
  try {
    const text = await picked.text();
    if (version !== loadVersion) return;
    const parsed = loadDocument(unpackDocument(JSON.parse(text)), { owned: true });
    useDocument(parsed, picked.name);
  } catch (error) {
    if (version === loadVersion) renderNotice(error);
  } finally {
    if (version === loadVersion) {
      file.value = '';
      loading = false;
      updateControls();
    }
  }
});
frame.addEventListener('change', () => {
  if (measuring || loading) return;
  const index = frame.valueAsNumber - 1;
  if (!Number.isInteger(index) || index < 0 || index >= doc.layers[0].frames.length) return;
  useFrame(index);
});

declare global {
  interface Window {
    meshBenchmark?: {
      canvas: Result;
      webgl: Result | null;
      referenceMs: number;
      workload: typeof workload;
      renderer?: string;
    };
  }
}

async function sampleFrames(
  draw: (shear: number, bend: number) => void, referenceMs: number, nextFrame: () => Promise<number>,
): Promise<Result> {
  for (let i = 0; i < 12; i++) {
    await nextFrame();
    draw(...motion(i / 12));
  }
  return measureDrawing(elapsed => draw(...motion(elapsed * 0.003)), nextFrame, referenceMs);
}

measure.addEventListener('click', async () => {
  if (measuring || loading || !paints.length) return;
  stopPreview();
  ++loadVersion; // A pending default sample must not replace the measured drawing.
  measuring = true;
  updateControls();
  resetMetrics();
  for (const overlay of overlays) overlay.clearRect(0, 0, WIDTH, HEIGHT);
  const controller = new AbortController();
  const signal = controller.signal;
  const checkVisibility = () => {
    if (document.hidden) controller.abort(new Error('Оставь вкладку открытой во время замера.'));
  };
  const nextFrame = () => new Promise<number>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      cancelAnimationFrame(id);
      reject(signal.reason);
    };
    const id = requestAnimationFrame(now => {
      signal.removeEventListener('abort', cancel);
      resolve(now);
    });
    signal.addEventListener('abort', cancel, { once: true });
  });
  document.addEventListener('visibilitychange', checkVisibility);
  checkVisibility();
  try {
    status.textContent = 'Измеряю частоту обновления вкладки…';
    const refresh: number[] = [];
    let previous = await nextFrame();
    for (let i = 0; i < 12; i++) {
      const now = await nextFrame();
      refresh.push(now - previous);
      previous = now;
    }
    const referenceMs = percentile(refresh, 50);
    let canvasResult!: Result;
    let gpuResult: Result | null = null;
    const runCanvas = async () => {
      status.textContent = 'Замер Canvas 2D…';
      canvasResult = await sampleFrames((shear, bend) => {
        moveGrid(grid, moved, shear, bend);
        drawCanvas(ctx, bound, moved);
      }, referenceMs, nextFrame);
    };
    const runWebGL = async () => {
      if (!gpu) return;
      status.textContent = 'Замер WebGL2…';
      gpuResult = await sampleFrames((shear, bend) => {
        if (!gpu) throw new Error('Контекст WebGL2 потерян во время замера.');
        gpu.draw(shear, bend);
      }, referenceMs, nextFrame);
    };
    for (const run of canvasFirst ? [runCanvas, runWebGL] : [runWebGL, runCanvas]) await run();
    canvasFirst = !canvasFirst;
    for (const [suffix, result] of [['2d', canvasResult], ['gl', gpuResult]] as const) {
      if (!result) continue;
      element(`cpu-${suffix}`).textContent = `${result.p95.toFixed(2)} мс`;
      element(`fps-${suffix}`).textContent = result.fps.toFixed(1);
      element(`late-${suffix}`).textContent = String(result.late);
    }
    status.textContent = `Замер готов. Длинный интервал — больше ${(referenceMs * 1.5).toFixed(1)} мс.`;
    window.meshBenchmark = { canvas: canvasResult, webgl: gpuResult, referenceMs, workload, renderer: gpu?.renderer };
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    document.removeEventListener('visibilitychange', checkVisibility);
    measuring = false;
    updateControls();
    renderPreview();
  }
});

webgl.addEventListener('webglcontextlost', () => {
  gpu = null;
  if (measuring) status.textContent = 'Контекст WebGL2 потерян.';
  renderNotice(new Error('Контекст WebGL2 потерян. Обнови страницу, чтобы восстановить его.'));
});

useDocument(fallbackDocument(), 'Синтетический кадр · можно загрузить свой .toonop');
const defaultVersion = loadVersion;
try {
  const response = await fetch('./sample.local.json');
  if (response.ok && defaultVersion === loadVersion) {
    const text = await response.text();
    if (defaultVersion === loadVersion) {
      const sample = loadDocument(unpackDocument(JSON.parse(text)), { owned: true });
      const credit = document.createElement('a');
      credit.href = 'https://toonop.ru/a/6vdmqf6t6ucq';
      credit.textContent = '«Eyes» · Gulya · кадр 1';
      useDocument(sample, credit);
    }
  }
} catch {
  // The synthetic drawing is already available.
}
