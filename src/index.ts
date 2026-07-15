/// <reference path="./lib/export/gifenc.d.ts" />

// Public entry point for embedding the editor inside another Svelte app
// (e.g. the platform's /editor route) via a single shared Svelte runtime.
//
// The standalone dev wrapper in src/dev/ is independent of this file and keeps
// running on its own (`bun run dev`).
export { default as Editor } from './lib/ui/Editor.svelte';
