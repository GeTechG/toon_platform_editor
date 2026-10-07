import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';

// What the phone's old notes measured and still holds, whatever the phone
// draws now (phone-is-the-desktop.test.ts): no breakpoint on both sides of an
// edge, heights in dvh, the bar's floor.
void plugins;
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const style = editorUi.slice(editorUi.indexOf('<style>'));

describe('the phone branch and the desktop branch do not overlap', () => {
  it('no breakpoint matches on both sides of the same edge', () => {
    const phoneEdges = [...editorUi.matchAll(/@media \(max-width: ([\d.]+)rem\)/g)].map((m) => m[1]);
    const deskEdges = [...editorUi.matchAll(/@media \(min-width: ([\d.]+)rem\)/g)].map((m) => m[1]);
    expect(deskEdges.filter((edge) => phoneEdges.includes(edge))).toEqual([]);
  });
});

describe('height in the studio is written in dvh', () => {
  // `vh` is the tall viewport: a value in it jumps the moment Mobile Safari
  // collapses its address bar.
  it('no rule measures a height in vh', () => {
    const bare = style.replace(/\/\*[\s\S]*?\*\//g, '');
    const stray = [...bare.matchAll(/[\w-]+:\s*[^;]*?\b[\d.]+vh\b[^;]*/g)].map((m) => m[0].trim());
    expect(stray).toEqual([]);
  });
});

// The floor under the bottom bar is arithmetic for rows one key tall; a
// transport that wraps took its second line out of the strip.
describe('a wrapped row raises the floor under the bar', () => {
  it('each key row is measured and what it takes over one key is added', () => {
    expect(editorUi).toContain('bind:contentRect={rowBoxes[i]}');
    const floor = editorUi.match(/const panelFloor = \$derived\([^]*?\n  \);/)?.[0] ?? '';
    expect(floor).toContain('wrapExtra');
  });
});

describe('the bar floor grows with the text size', () => {
  it('the px of the floor and of one key row are scaled by the root text size', () => {
    expect(editorUi).toMatch(/const textScale = \$derived/);
    const floor = editorUi.match(/const panelFloor = \$derived\([^]*?\n  \);/)?.[0] ?? '';
    expect(floor).toContain('* textScale');
    expect(editorUi).toMatch(/KEY_ROW \* textScale/);
  });
});
