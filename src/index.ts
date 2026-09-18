/// <reference path="./lib/export/gifenc.d.ts" />

// Public entry point for embedding the editor inside another Svelte app
// (e.g. the platform's /editor route) via a single shared Svelte runtime.
//
// The standalone dev wrapper in src/dev/ is independent of this file and keeps
// running on its own (`bun run dev`).
export { default as Editor } from './lib/ui/Editor.svelte';

// Read-only looping viewer for a document (the platform's public share page).
export { default as Player } from './lib/player/Player.svelte';
export type { ToonDocument } from './lib/format/types';

// The soundtrack the editor hands back with a published document.
export type { AudioTrackData } from './lib/audio/state.svelte';

// Animated-WebP gallery preview built from a document at publish time.
export { buildPreview } from './lib/export/preview-webp';
