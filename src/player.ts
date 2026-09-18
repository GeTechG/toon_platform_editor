// Player-only entry point for the public share page.
//
// The barrel in ./index.ts re-exports Editor alongside Player, which puts both
// in one module and therefore in one Rollup chunk: a visitor opening a shared
// link downloaded the whole editor (toolbar, eraser, onion-skin, publish) to
// watch an 8-frame loop. This subpath keeps the viewer's graph to the renderer
// and the loop clock.
export { default } from './lib/player/Player.svelte';
export type { ToonDocument } from './lib/format/types';
