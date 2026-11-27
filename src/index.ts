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
export { packDocument, unpackDocument } from './lib/format/pack';
export { isEmptyDocument } from './lib/model/operations';

// The soundtrack the editor hands back with a published document.
export type { AudioTrackData } from './lib/audio/state.svelte';
// What the API keeps of a soundtrack; the platform names it when one is refused.
export { PUBLISH_AUDIO_MAX_BYTES, SOUND_PRICE } from './lib/audio/track';

// Animated-WebP gallery preview built from a document at publish time.
export { buildPreview } from './lib/export/preview-webp';

// The studio's commands by name, for the page's error reports (no data of the drawing).
export { onEditorCommand } from './lib/ui/command-trail';

export { deleteDraftIfVersion, onDraftFailure, type DraftFailureDetail, type DraftVersion } from './lib/draft/store';
export { pinRasterUpload, readRasterAsset, unpinRasterUpload } from './lib/draft/raster-store';
export { rasterInventory } from './lib/format/studio-document';
export type { ReadRasterAsset } from './lib/format/project';
