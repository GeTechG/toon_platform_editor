import { expect, it } from 'bun:test';
import { EDGE_KEEP, clampPan, footOf } from './viewport';

// What the 2026-10-08 critique found by working at the desk: each of these
// held until a note, a panel or a window stood where the code had not looked.
const read = (file: string) => Bun.file(new URL(file, import.meta.url).pathname).text();
const editor = await read('./Editor.svelte');
const drag = await read('./draggable.ts');
const transform = await read('./TransformMenu.svelte');
const canvas = await read('./CanvasView.svelte');
const rows = await read('./LayerRows.svelte');
const swatches = await read('./ColorPanel.svelte');
const timeline = await read('./Timeline.svelte');

it('does not count the first-visit note as keys of the top row', () => {
  // The note takes a line of its own; summed into the row's need it folded a
  // 1440px desk into the phone's six keys at the first autosave.
  expect(editor).toContain("kid.matches('.saved, .top-note')");
});

it('opens the transform window where the hand left it', () => {
  expect(drag).toMatch(/export function draggable\(node: HTMLElement, remember\?: string\)/);
  expect(drag).toMatch(/remembered\.set\(remember,/);
  expect(transform).toContain("use:draggable={'transform'}");
});

it('lets go of the frame-rate field on Enter and Escape', () => {
  const field = editor.match(/<input\s+type="number"[^>]*onchange=\{onFpsChange\}[^>]*>/)?.[0] ?? '';
  expect(field).toContain('onkeydown={leaveField}');
  expect(editor).toMatch(/function leaveField[^}]*'Enter'[^}]*'Escape'[^}]*blur\(\)/);
});

it('keeps an edge of the sheet above a panel lying across the foot of the table', () => {
  const stage = { width: 400, height: 300, sheetWidth: 200, sheetHeight: 100 };
  const panel = { x: 0, y: 220, width: 400, height: 80 };
  expect(footOf([panel], 400, 300)).toBe(220);
  // A window in the corner and the shy zoom window are not the table's foot.
  expect(footOf([{ x: 0, y: 250, width: 120, height: 50 }], 400, 300)).toBe(300);
  expect(footOf([{ ...panel, shy: true }], 400, 300)).toBe(300);
  expect(clampPan({ zoom: 1, panX: 0, panY: 999 }, { ...stage, foot: 220 }).panY).toBe(220 - EDGE_KEEP);
  expect(clampPan({ zoom: 1, panX: 0, panY: 999 }, stage).panY).toBe(300 - EDGE_KEEP);
  expect(canvas).toMatch(/foot: footOf\(covers,/);
});

it('gives the keyboard back to a moved layer only when the keyboard was there', () => {
  // A layer dragged by the mouse and undone took the focus onto its tag, and
  // Space recoloured the layer instead of playing.
  expect(rows).toMatch(/hadFocus = .*:focus-visible/);
});

it('wraps the swatches in a floating window as in a side column', () => {
  expect(swatches).toMatch(/:where\(\[data-slot='left'\], \[data-slot='right'\], \[data-slot='float'\]\)/);
});

it('scrolls the frames along with a plain wheel', () => {
  expect(timeline).toMatch(/onwheel=\{wheelAlong\}/);
});

// --- the phone and the sheets ----------------------------------------------

const exportSheet = await read('./ExportSheet.svelte');
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url).pathname).json();

it('charges the standing thickness widget no column on a phone', () => {
  // There the sheet lies under the widget; charged for a column it never
  // took, the widget lay down under an upright sheet and made it smaller.
  expect(editor).toMatch(/\{ side: compact \? 0 : \(SIDEBAR_REM \+ SIDE_GAP\) \* rem,/);
});

it('keeps the whole screen under the drafts, the settings and the export', () => {
  // They are the editor's own children and open inside full screen; leaving
  // it for them gave a phone its bars back for the rest of the visit.
  expect(editor.includes('leaveFullscreen')).toBe(false);
});

it('closes the sound plate on Escape from the key that opened it', () => {
  expect(editor).toMatch(/bind:this=\{audioKey\}\s+onkeydown=\{escAudio\}/);
});

it('opens the export on its own key, not on «Закрыть»', () => {
  expect(exportSheet).toMatch(/dialogEl\?\.showModal\(\);\s+downloadEl\?\.focus\(\);/);
});

it('names the send key by the word written on it', () => {
  expect(ru.editor.publish).toContain(ru.editor.publish_short);
});

// --- the owner's answers, 2026-10-08 ---------------------------------------

import { addStroke, createDocument, duplicateFrame } from '../model/operations';
import { frameMenuKey } from './frame-selection';

it('duplicates a frame after itself, in every layer, as a copy of its own', () => {
  const doc = createDocument();
  addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#112233' });
  expect(duplicateFrame(doc, 0)).toBe(1);
  expect(doc.layers[0].frames).toHaveLength(2);
  expect(doc.layers[0].frames[1]).toEqual(doc.layers[0].frames[0]);
  // A copy: a stroke added to one is not in the other.
  addStroke(doc, 0, 1, { points: [3, 4], width: 8, color: '#112233' });
  expect(doc.layers[0].frames[0].strokes).toHaveLength(1);
  expect(doc.layers[0].frames[1].strokes).toHaveLength(2);
});

it('offers «Дублировать» in the frame menu', () => {
  expect(timeline).toContain('onclick={() => run(() => editor.duplicateActiveFrame())}');
  expect(frameMenuKey('duplicate', true, false)?.label).toBe('G');
  expect(frameMenuKey('duplicate', false, false)).toBeNull();
  expect(ru.panel.item.duplicate_frame).toBe('Дублировать кадр');
});

it('tells the truth when the draft on the sheet is deleted', () => {
  // The card goes, the drawing stays and is saved anew — «отменить нельзя»
  // promised a loss that did not happen.
  expect(ru.editor.draft_delete_open_confirm).toContain('останется');
  expect(editor).toContain("t('editor.draft_delete_open_confirm')");
});

it('draws the way to the site wherever the host hands it over', () => {
  // The host decides (its bar is away: a phone lying down, full screen, a low
  // desktop window); the studio no longer second-guesses it by the screen's
  // shape, and a desk — which has no «⋯» — gets the key at the head of its row.
  expect(editor.includes('home && !tall')).toBe(false);
  expect(editor.includes('tall ? undefined : home')).toBe(false);
  expect(editor).toContain('{#if home && !compact}<a class="key" href={home.href} title={home.label} aria-label={home.label}>');
});
