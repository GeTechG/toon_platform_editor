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
    expect(rows.at(-1)).toEqual(['tool:pencil', 'tool:eraser', 'tool:pipette', 'brush-sizes', 'color', 'history', 'add-frame', 'delete-frame']);
  });

  it('Toonio, which places it, gets no second one', () => {
    const cut = deskOnPhone(presetPanels('toonio')).panels;
    expect([...cut.left, ...cut.rows.flat()].filter((id) => id === 'history')).toEqual(['history']);
    // …and it stands with the keys, not in the rail (owner, 2026-10-13).
    expect(cut.left).not.toContain('history');
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

// The owner's answers the same day.
describe('a frame added is taken back by Z (owner, 2026-10-13)', () => {
  it('an added, a duplicated and an inserted frame are each filed as one undo step, like a delete', async () => {
    // The state is runes and does not stand up under bun: held to the source,
    // as the audits hold it; the live run presses «+» and Z.
    const state = await read('editor-state.svelte.ts');
    for (const add of ['addFrameAfterActive', 'duplicateActiveFrame', 'addFrameBeforeActive']) {
      const body = state.slice(state.indexOf(`  ${add}(): void {`), state.indexOf('\n  }\n', state.indexOf(`  ${add}(): void {`)));
      expect(body.indexOf('const before = this.takeStructure();')).toBeGreaterThan(-1);
      expect(body.indexOf('this.pushStructure(before);')).toBeGreaterThan(body.indexOf('this.#write('));
    }
  });
});

describe('a press on the sheet while the preview runs (owner, 2026-10-13)', () => {
  it('stops the preview and draws nothing — a finger on its lift, so two fingers still move the sheet under a running film', async () => {
    const canvas = await read('CanvasView.svelte');
    expect(canvas).toMatch(/if \(editor\.playing && e\.isPrimary\) \{[^}]*if \(e\.pointerType === 'touch'\) stopOnLift = e\.pointerId;\s*else editor\.stopPreview\?\.\(\);\s*return;/);
    expect(canvas).toMatch(/if \(!e\.isPrimary\) stopOnLift = null;/);
    expect(canvas).toMatch(/if \(stopOnLift === e\.pointerId\) \{\s*stopOnLift = null;\s*editor\.stopPreview\?\.\(\);/);
    expect(await read('PlayControls.svelte')).toContain('editor.stopPreview = stop;');
  });
});

describe('the tour once more (owner, 2026-10-13)', () => {
  it('help brings it back over whatever is drawn, and the first-visit flag is not touched', async () => {
    const editor = await read('Editor.svelte');
    expect(editor).toContain("editor.tourReplay = true; }}>{t('editor.tour_again')}</button>");
    expect(editor).toContain('{#if (editor.presetAsk || editor.tourReplay) && plateDue && !editor.arranging}');
    expect(await read('editor-state.svelte.ts')).toMatch(/closePresetAsk\(\): void \{\s*this\.tourReplay = false;/);
    expect(ru.tour.export.text).toBe('Экспортируй мульт в GIF или видео, а один кадр — в PNG.');
  });
});

describe('a tool that arrives stands with the tools (owner, 2026-10-13)', () => {
  it('comes into the column after the last tool, not after undo and what follows it', async () => {
    const { normalizePanels } = await import('./panels');
    const left = normalizePanels({ left: ['tool:pencil', 'history', 'manual'], right: [], top: [], rows: [['timeline']], float: [], hidden: [] }).left;
    expect(left.slice(0, 2)).toEqual(['tool:pencil', 'tool:eraser']);
    expect(left.indexOf('history')).toBeGreaterThan(left.findIndex((id) => !id.startsWith('tool:')) - 1);
    expect(left.slice(left.indexOf('history')).filter((id) => id.startsWith('tool:'))).toEqual([]);
  });
});

describe('a column of tools taller than the screen (owner, 2026-10-13)', () => {
  const layout = { left: ['tool:pencil', 'tool:eraser', 'tool:pipette', 'tool:drag', 'brush-rail', 'history'], right: [], top: [], rows: [['timeline']], float: [], hidden: [] };

  it('keeps its first tools and puts the last behind «Другие инструменты», where the first of them stood', async () => {
    const { foldColumn } = await import('./small-screen');
    const cut = foldColumn(null, layout, 1)!;
    // One key too many: two tools go, their one key comes.
    expect(cut.panels.left).toEqual(['tool:pencil', 'tool:eraser', 'tools', 'brush-rail', 'history']);
    expect(cut.tools).toEqual(['tool:pipette', 'tool:drag']);
  });

  it('with room for all it is the layout as it stood', async () => {
    const { foldColumn } = await import('./small-screen');
    expect(foldColumn(null, layout, 0)).toBeNull();
  });

  it('joins the key the bar over the canvas already has, without a second one', async () => {
    const { foldColumn } = await import('./small-screen');
    const base = { panels: { ...layout, top: ['tools'] }, more: [], tools: ['tool:lasso'] };
    const cut = foldColumn(base, base.panels, 1)!;
    expect(cut.panels.left).toEqual(['tool:pencil', 'tool:eraser', 'tool:pipette', 'brush-rail', 'history']);
    expect(cut.tools).toEqual(['tool:lasso', 'tool:drag']);
  });
});

describe('small things of the same run', () => {
  it('«Дублировать кадр» has a sign of its own, not «Копировать»’s', async () => {
    expect(await read('Timeline.svelte')).toContain(`<Icon name="duplicate" size={16} /><span>{t('panel.item.duplicate_frame')}</span>`);
    expect(await read('Icon.svelte')).toContain("duplicate: 'M9 9h11v11H9zM5 15V4h11M14.5 12v5M12 14.5h5',");
  });

  it('an answered question does not leave the keyboard on <body>', async () => {
    expect(await read('Editor.svelte')).toMatch(/asked\?\.done\(yes\);[\s\S]{0,260}document\.activeElement === document\.body[\s\S]{0,120}\.cell\[tabindex="0"\]/);
  });
});

describe('a small phone under a desk (owner, 2026-10-13, an iPhone SE under Toonio)', () => {
  it('the tour’s mascot gives way before the card’s keys go under its edge', async () => {
    expect(await read('Tour.svelte')).toMatch(/\.mascot \{[^}]*min-height: 3rem;/);
  });

  it('the strip under three rows of keys shows fewer layers, so the sheet keeps the screen', async () => {
    expect(await read('Editor.svelte')).toMatch(/\.studio\.compact\.desk\.tall \.panel :global\(\.board\) \{\s*max-height: 22dvh;/);
  });

  it('the save note stands clear of the fold tab over the panel', async () => {
    expect(await read('Editor.svelte')).toMatch(/\.studio\.desk \.toolbar \.row > :global\(\.saved\) \{[^}]*bottom: calc\(100% \+ 1\.75rem\);/);
  });
});

describe('the rail of a desk standing on a phone stays one key wide (owner, 2026-10-13)', () => {
  it('folds what its first column has no room for behind «Другие инструменты», measured by where the keys stand', async () => {
    const editor = await read('Editor.svelte');
    expect(editor).toContain('(compact && !(deskPhone && tall)) || editor.arranging ? 0 : leftSpill));');
    expect(editor).toMatch(/if \(deskPhone\) \{[\s\S]{0,700}if \(first < lefts\.length\) leftSpill = lefts\.length - first;/);
  });
});

describe('the sheet beside the finger’s thickness rail (owner, 2026-10-13: «холст очень маленький»)', () => {
  it('is fitted beside the rail, not under its foot: the rail is a side’s, however near the top it starts', async () => {
    const { fitSheet } = await import('./viewport');
    // An iPhone SE under Toonio: the tools' column, the rail, the bottom panel
    // the table runs on under.
    const covers = [
      { x: 0, y: 0, width: 73, height: 666 },
      { x: 93, y: 17, width: 44, height: 201, side: true },
      { x: 0, y: 306, width: 375, height: 360 },
    ];
    const sheet = fitSheet(375, 666, { width: 16, height: 9 }, covers);
    expect(sheet.x).toBeGreaterThanOrEqual(137);
    expect(Math.round(sheet.width)).toBe(206);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(306);
  });

  it('the rail says so to the fit', async () => {
    const canvas = await read('CanvasView.svelte');
    expect(canvas).toMatch(/class="size-rail"\s*data-over-sheet="side"/);
    expect(canvas).toContain("side: el.dataset.overSheet === 'side' || undefined");
  });
});
