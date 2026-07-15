/**
 * Benchmark entry: reads config from the query string, sizes a canvas to real
 * device pixels, runs the probes, and renders a PASS/FAIL table. The result is
 * also published on `window.__BENCH_RESULT__` and signalled via a
 * `data-bench-state` attribute so Playwright (or any driver) can await and read
 * it without scraping the table.
 */

import './bench.css';
import { configFromQuery } from './config';
import { runBench, type BenchResult } from './run';

declare global {
  interface Window {
    __BENCH_RESULT__?: BenchResult;
  }
}

const root = document.getElementById('bench')!;
root.dataset.benchState = 'running';

const cfg = configFromQuery(window.location.search);

// Real device pixels: a low-end phone runs dpr 2–3, so the canvas is large and
// fills/blits are genuinely heavy — the whole point of a low-end benchmark.
const dpr = window.devicePixelRatio || 1;
const cssWidth = 600;
const cssHeight = 300;
const canvas = document.createElement('canvas');
canvas.width = Math.round(cssWidth * dpr);
canvas.height = Math.round(cssHeight * dpr);
canvas.style.width = `${cssWidth}px`;
canvas.style.height = `${cssHeight}px`;
canvas.className = 'bench-canvas';

const status = document.createElement('p');
status.className = 'bench-status';
status.textContent = `Running… corpus ${cfg.frames}×${cfg.strokesPerFrame}, dpr ${dpr}, canvas ${canvas.width}×${canvas.height}px`;

root.append(status, canvas);

runBench(canvas, cfg)
  .then((result) => {
    window.__BENCH_RESULT__ = result;
    status.textContent = `Overall: ${result.overall} — corpus ${result.corpus.frames} frames × ${result.corpus.strokesPerFrame} strokes (${result.corpus.totalStrokes} total), dpr ${dpr}`;
    root.append(renderTable(result));
    root.dataset.benchState = 'done';
  })
  .catch((err) => {
    status.textContent = `Bench failed: ${err instanceof Error ? err.message : String(err)}`;
    root.dataset.benchState = 'error';
    throw err;
  });

function renderTable(result: BenchResult): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'bench-table';
  table.innerHTML = '<thead><tr><th>metric</th><th>measured</th><th>threshold</th><th>verdict</th></tr></thead>';
  const body = document.createElement('tbody');
  for (const m of result.metrics) {
    const tr = document.createElement('tr');
    tr.dataset.verdict = m.verdict;
    for (const cell of [m.name, m.value, m.threshold, m.verdict]) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  return table;
}
