import { describe, expect, it } from 'bun:test';
import ru from '../i18n/ru.json';
import { plugins } from '../plugins';
import { presetPanels } from './presets';
import { deskOnPhone } from './small-screen';

// Critique 2026-10-13, the studio on a desk and on a phone: what the live run
// found, held to the source the way the audits' tests hold theirs.
void plugins;
const UI = new URL('./', import.meta.url).pathname;
const read = (name: string) => Bun.file(UI + name).text();

describe('a phone that keeps a desk without undo', () => {
  it('Multator: the step back joins the drawing row — a finger has no Z and no shelf to fetch the key from', () => {
    const rows = deskOnPhone(presetPanels('multator')).panels.rows;
    expect(rows.at(-1)).toEqual(['tool:pencil', 'tool:eraser', 'tool:pipette', 'brush-sizes', 'color', 'history']);
  });

  it('Toonio, which places it, gets no second one', () => {
    const cut = deskOnPhone(presetPanels('toonio')).panels;
    expect([...cut.left, ...cut.rows.flat()].filter((id) => id === 'history')).toEqual(['history']);
  });
});

describe('the thickness rail under a finger', () => {
  it('stands in the middle of the stage that shows, not of the table that runs on under the bottom panel', async () => {
    const canvas = await read('CanvasView.svelte');
    const rail = canvas.slice(canvas.indexOf('\n  .size-rail {'), canvas.indexOf('display: none;', canvas.indexOf('\n  .size-rail {')));
    expect(rail).toContain('top: max(0.75rem, (100% - var(--stage-under, 0px)) / 2 - 8rem);');
    expect(rail).toContain('bottom: calc(var(--stage-under, 0px) + max(4.5rem, (100% - var(--stage-under, 0px)) / 2 - 8rem));');
  });
});

describe('the drafts hub on a phone', () => {
  it('breaks its title between words, and «На сайт» not at all', async () => {
    const hub = await read('DraftsHub.svelte');
    const h2 = hub.slice(hub.indexOf('\n  .hub-head h2 {'), hub.indexOf('}', hub.indexOf('\n  .hub-head h2 {')));
    expect(h2).toContain('overflow-wrap: break-word;');
    expect(h2).not.toContain('min-width: 0;');
    expect(hub).toMatch(/\.hub-head a\.key \{\s*white-space: nowrap;/);
  });

  it('shows no box on a card once the choosing is over', async () => {
    expect(await read('DraftsHub.svelte')).toMatch(/\.hub\.touch \.drafts:not\(\.choosing\) \.draft-pick \{\s*visibility: hidden;/);
  });
});

describe('what the studio says of itself', () => {
  it('the tour opens a .toon by a way a phone has too', () => {
    expect(ru.tour.toon.text).toContain('«Открыть файл...»');
  });

  it('help names the repeat press that opens a tool’s settings, where a key opens them', async () => {
    const editor = await read('Editor.svelte');
    expect(editor).toContain("'tool_again'");
    expect(ru.gesture.tool_again.length).toBeGreaterThan(0);
    expect(ru.gesture_does.tool_again.length).toBeGreaterThan(0);
  });

  it('help lists G, the key the frame’s menu shows', async () => {
    expect(await read('Editor.svelte')).toContain("['G', t('panel.item.duplicate_frame')]");
  });
});

describe('the windows of the desk', () => {
  it('«Палитры» keeps its name: saving the palette stands by the palette, not in the header', async () => {
    const colours = await read('ColoursPanel.svelte');
    const header = colours.slice(colours.indexOf('<header>'), colours.indexOf('</header>'));
    expect(header).not.toContain('savePalette');
    expect(header).toContain("<h2>{t('colours.title')}</h2>");
    expect(colours).toMatch(/\{#if tab === 'palettes'\}\s*<button class="key icon" onclick=\{savePalette\}[^>]*>\s*<Icon name="save" \/>/);
  });

  it('export says the file is ready over the picture, where a low window does not cut it', async () => {
    const sheet = await read('ExportSheet.svelte');
    expect(sheet.indexOf('<p class="made"')).toBeLessThan(sheet.indexOf('<img class="result"'));
  });

  it('the transform’s thickness switch folds with the numbers, clear of the keys that end the mode', async () => {
    const menu = await read('TransformMenu.svelte');
    expect(menu.indexOf('transform.width_with_scale')).toBeLessThan(menu.indexOf('</details>'));
  });
});
