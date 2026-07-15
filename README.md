# toon-editor

Frame-by-frame hand-drawn animation editor (toon-platform, phase 1).
Standalone package: Svelte 5 + Vite + TypeScript on Bun, Canvas 2D behind
the `FrameRenderer` contract, a versioned JSON document format with
RFC 8785 canonicalization and a SHA-256 integrity hash.

Status: foundation (`editor-foundation` change) — canvas, brush,
timeline, 12–24 fps loop playback.

## Layout

- `src/lib/format/` — document format: types, constants, JSON Schema,
  validation (ajv + semantic checks), canonicalization, hash, fixture corpus
- `src/lib/model/` — document operations (the only mutation path)
- `src/lib/render/` — `FrameRenderer` contract, Canvas 2D implementation,
  Bézier smoothing
- `src/lib/tools/` — brush: Lang simplification, quantization, stroke assembly
- `src/lib/player/` — loop playback logic
- `src/lib/ui/` — editor Svelte components
- `src/dev/` — dev wrapper (a page that mounts the editor standalone)

## Commands

```sh
bun install    # dependencies
bun run dev    # editor dev page
bun test src   # unit tests + fixture corpus
bun run check  # svelte-check / types
bun run build  # production build of the dev wrapper
```

## Benchmark (low-end device gate)

`bench.html` is a standalone page (separate Vite entry, `src/bench/`) that runs
the editor's real render path over a synthetic corpus (N frames × M strokes) and
prints a PASS/FAIL table for the phase-1 quality gate. It reuses the actual
render primitives — it does not re-implement the hot path.

Three metrics:

- **input-to-paint p95** — time from a live-stroke point to draw-complete
  (default threshold ≤ 32 ms).
- **playback fps** — loop playback holds ≥ 24 fps without drops (default: ≥ 95%
  of delivered frames within 1.5× the target interval).
- **alloc-loop (heap)** — steady-state JS-heap growth over the window, as a
  least-squares trend so GC sawtooth is not mistaken for a leak (default ≤ 8 MB).
  Needs `performance.memory` (Chromium); elsewhere the metric is **SKIP**, never
  a false PASS.

Run it two ways — same page, no rebuild:

```sh
# On a device (incl. a real 2 GB Android): open the URL, read the table.
bun run bench                         # opens /bench.html on the dev server

# Repeatable, under CPU throttling — drive with the playwright-cli skill:
#   1. bun run dev
#   2. open http://localhost:5173/bench.html in Chromium
#   3. CDP Emulation.setCPUThrottlingRate { rate: 4 }
#   4. await #bench[data-bench-state="done"], read window.__BENCH_RESULT__
```

Every parameter and threshold is a query override, e.g.
`bench.html?frames=200&latencyP95MaxMs=24` (defaults in `src/bench/config.ts`).
The result is published on `window.__BENCH_RESULT__` and the run state on the
`#bench` element's `data-bench-state` (`running` → `done`/`error`) for headless
drivers.

The default thresholds are a starting point; the heap-growth bound in particular
must be **calibrated on a real 2 GB Android** (device memory/GPU/thermals differ
from a throttled desktop). A throttled desktop run is a repeatability proxy, not
the source of truth.
