import { expect, it } from 'bun:test';

// The host's note over the canvas is the site's first-run hint («Кадр пустой?
// Значит, ты у старта»). It stood over a four-frame draft opened by keyboard,
// and under the hub that covers the studio. The studio is the one that knows
// both, so it shows the note only where its words are true.
const source = await Bun.file(new URL('./Editor.svelte', import.meta.url).pathname).text();

it('the stage note is drawn only over an empty drawing with the hub and the «⋯» window down', () => {
  expect(source).toMatch(/\{#if isEmptyDocument\(editor\.doc\) && !draftsOpen && !moreOpen\}\s*\{@render stageNote\?\.\(\)\}\s*\{\/if\}/);
});
