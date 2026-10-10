import { expect, it } from 'bun:test';

// The host's note over the canvas is the site's first-run hint («Кадр пустой?
// Значит, ты у старта»). It stood over a four-frame draft opened by keyboard,
// and under the hub that covers the studio. The studio is the one that knows
// both, so it shows the note only where its words are true.
const source = await Bun.file(new URL('./Editor.svelte', import.meta.url).pathname).text();

// The hint's second half («потом добавь кадр кнопкой „+“») left with the first
// stroke — the moment it became the next thing to do. The note now stands until
// the toon has a second frame, and the host is told whether a line is drawn.
it('the stage note is drawn until the toon has a line and a second frame, with the hub and the «⋯» window down', () => {
  // The walk now ends at play (owner, 2026-10-08), so the host is told the
  // count of frames and whether the toon is playing, and ends the note itself.
  expect(source).toContain('const noteDue = $derived(!draftsOpen && !moreOpen && !(deskPhone && !tall));');
  expect(source).toContain('{#if noteDue && !noteInPanel && !noteInTop && !editor.presetAsk && !(compact && !isEmptyDocument(editor.doc))}{@render stageNote?.(!isEmptyDocument(editor.doc), frameCount(editor.doc), editor.playing)}{/if}');
  expect(source).toContain('stageNote?: Snippet<[drawn: boolean, frames: number, playing: boolean]>;');
});

// On a phone the sheet fills the stage, so the note lay on the paper the first
// line is meant for (owner, 2026-10-08). There it stands in the bottom bar,
// over the «+» it speaks of; a bare bar lying down keeps it on the stage.
it('a phone stands the note in its bottom bar, off the sheet', () => {
  expect(source).toContain('const noteInPanel = $derived(!panelFolded && panels.rows.length > 0 && ((compact && !barBare) || !draws(panels.top)));');
  expect(source).toContain('{#if noteDue && noteInPanel}<div class="panel-note" bind:offsetHeight={panelNoteH}>{@render stageNote?.(!isEmptyDocument(editor.doc), frameCount(editor.doc), editor.playing)}</div>{/if}');
});

// The host keeps the row's names for its whole walk (owner, 2026-10-08). Where
// the walk has no room to go on — a phone lying down, the bar bare — nothing
// would ever take them back, so there they go with the first line, as before.
it('the row wears its names past the first line only where the walk goes on', () => {
  expect(source).toContain('class:named={named && !rowPressed && (noteInPanel || noteInTop || isEmptyDocument(editor.doc))}');
});

// Lying down and on a wide screen the note still lay on the sheet (owner,
// 2026-10-08: «пофикси везде»). Where the bottom bar cannot hold it, it is a
// line of the bar over the canvas; the stage is left for a layout with no bar.
it('with no room in the bottom bar the note is a line of the top bar, never on the sheet', () => {
  expect(source).toContain('const noteInTop = $derived(!noteInPanel && draws(panels.top) && !editor.arranging);');
  expect(source).toContain('{#if noteDue && noteInTop}<div class="top-note">{@render stageNote?.(!isEmptyDocument(editor.doc), frameCount(editor.doc), editor.playing)}</div>{/if}');
  expect(source).toMatch(/\.studio \.top > \.top-note \{\s*flex: 0 0 100%;/);
});

// The empty holder was still a row of the bar's wrap — a gap and a margin — so
// the bar stood taller with nothing in it and jumped when «⋯» took it down.
it('a holder with no words takes no room in the top bar', () => {
  expect(source).toMatch(/\.studio \.top > \.top-note:empty \{\s*display: none;/);
});
