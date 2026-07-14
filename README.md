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
