import { describe, expect, it } from 'bun:test';
import { closedAPopup, dismissedOnly, notePopupClosed } from './dismiss-press';

// The owner, 2026-10-08: a tap that closes a popup only closes it. A tap on
// the sheet to put away the colours, «⋯» or a frame's menu left a dot of the
// brush in hand — three of them in one run of the phone critique.
const press = (): Event => new Event('pointerdown');

describe('a press that closed a popup', () => {
  it('is known by the press itself, not by its pointer: the mouse is pointer 1 every time', () => {
    const closing = press();
    notePopupClosed(closing);
    expect(closedAPopup(closing)).toBe(true);
    expect(closedAPopup(press())).toBe(false);
    expect(closedAPopup(null)).toBe(false);
  });

  it('that ended where it began only closed the popup: no dot', () => {
    const closing = press();
    notePopupClosed(closing);
    expect(dismissedOnly(closing, { dx: 3, dy: 4 }, 'touch')).toBe(true);
    expect(dismissedOnly(closing, { dx: 0, dy: 0 }, 'mouse')).toBe(true);
  });

  it('that travelled is a stroke, and draws from its first point', () => {
    const closing = press();
    notePopupClosed(closing);
    // 10 px for a finger, 4 for a mouse or a pen: the studio's own drag threshold.
    expect(dismissedOnly(closing, { dx: 8, dy: 6 }, 'touch')).toBe(false);
    expect(dismissedOnly(closing, { dx: 4, dy: 0 }, 'mouse')).toBe(false);
  });

  it('a press that closed nothing is a dot, as ever', () => {
    notePopupClosed(press());
    expect(dismissedOnly(press(), { dx: 0, dy: 0 }, 'touch')).toBe(false);
  });
});

describe('what closes a popup tells of it, and the sheet asks', () => {
  const read = (name: string) => Bun.file(new URL(`./${name}`, import.meta.url)).text();
  it('the box of a key, «⋯» and the sound’s plate, the frame’s menu', async () => {
    expect(await read('PopKey.svelte')).toMatch(/if \(hit && !plate\?\.contains\(hit\) && !key\?\.contains\(hit\)\) \{\s*open = false;\s*notePopupClosed\(e\);/);
    const editorUi = await read('Editor.svelte');
    expect(editorUi.match(/const away = \(e: PointerEvent\) => \{[^]*?\n    \};/)?.[0].match(/notePopupClosed\(e\)/g)?.length).toBe(2);
    expect(await read('Timeline.svelte')).toMatch(/if \(menu && !menuEl\?\.contains\(e\.target as Node\)\) \{\s*closeMenu\(\);\s*notePopupClosed\(e\);/);
  });

  it('the sheet drops the stroke, and the mega-eraser its pass, of a press that only closed a popup', async () => {
    const canvas = await read('CanvasView.svelte');
    const up = canvas.slice(canvas.indexOf('function onPointerUp'), canvas.indexOf('function dragTransform'));
    expect(up).toMatch(/if \(onlyDismissed\(e\)\) \{\s*megaGesture = null;/);
    expect(up).toMatch(/if \(onlyDismissed\(e\)\) \{\s*pointer\.discard\(\);/);
  });
});
