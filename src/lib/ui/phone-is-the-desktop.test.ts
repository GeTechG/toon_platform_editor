import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { defaultPanels, movePanelItem, toolItem, toolOpensBrush } from './panels';
import { DEFAULT_PRESET, presetPanels, presetUx } from './presets';
import { HYSTERESIS, phoneLayout, phoneTools, pickStep, toolRoom } from './small-screen';

// The owner, 2026-10-07: «сделай телефонный/планшетный варианты как у
// procreate, по сути это нынешний десктоп». A tablet already draws the
// desktop; a phone draws toonop's desktop cut to one row of keys, whatever
// the arrangement — the tabs and their one window are gone.
void plugins;
const base = presetPanels(DEFAULT_PRESET);
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const ru = JSON.parse(await Bun.file(new URL('../i18n/ru.json', import.meta.url)).text());
/** Everything behind «⋯», whatever its group. */
const all = (cut: ReturnType<typeof phoneLayout>) => cut.more.flatMap((group) => group.items);
// toonop draws no pipette key: a held finger does its work.
const keep = { tools: phoneTools(presetUx(DEFAULT_PRESET)), tall: true, room: 4, drawn: (tool: string) => tool !== 'pipette' };

describe('a phone draws toonop’s desktop', () => {
  it('the top bar is one row: publish, «⋯», the essential tools, a key for the other tools, the colour', () => {
    const cut = phoneLayout(base, base, keep);
    expect(cut.panels.top).toEqual(['publish', 'more', 'spring', 'tool:pencil', 'tool:eraser', 'tools', 'color-key']);
    // The transform among them (owner, 2026-10-07: «трансформацию спрячь в инструменты»).
    expect(cut.tools).toEqual(['tool:feather', 'tool:mega-eraser', 'tool:drag', 'tool:lasso']);
  });

  it('the row scales with the screen: a wide one holds every tool and no key for the rest, any other only the essential ones', () => {
    const wide = phoneLayout(base, base, { ...keep, room: 12 });
    expect(wide.panels.top).toEqual(['publish', 'more', 'spring', 'tool:pencil', 'tool:eraser', 'tool:feather', 'tool:mega-eraser', 'tool:drag', 'tool:lasso', 'color-key']);
    expect(wide.tools).toEqual([]);
    // One short of them all: still only the essential ones, not «whatever came next».
    const near = phoneLayout(base, base, { ...keep, room: 5 });
    expect(near.panels.top).toEqual(['publish', 'more', 'spring', 'tool:pencil', 'tool:eraser', 'tools', 'color-key']);
    const narrow = phoneLayout(base, base, { ...keep, room: 2 });
    expect(narrow.panels.top).toEqual(['publish', 'more', 'spring', 'tool:pencil', 'tools', 'color-key']);
    expect(narrow.tools).toEqual(['tool:eraser', 'tool:feather', 'tool:mega-eraser', 'tool:drag', 'tool:lasso']);
  });

  it('how many tools the row has room for is worked out from its width and the text size', () => {
    // 390 px at 100 %: 1 rem of padding, «Отправить» 3.25 rem and its gap, «⋯» and the colour 48 px each.
    expect(toolRoom(390, 16, { publish: true, keys: 2 })).toBe(4);
    expect(toolRoom(320, 16, { publish: true, keys: 2 })).toBe(3);
    // Lying down, undo and redo stand in the row too.
    expect(toolRoom(844, 16, { publish: true, keys: 4 })).toBe(12);
    // Never under two: a tool and the key for the rest.
    expect(toolRoom(200, 32, { publish: true, keys: 2 })).toBe(2);
  });

  it('the sidebar and the bar under the canvas are the desktop’s own', () => {
    const cut = phoneLayout(base, base, keep);
    expect(cut.panels.left).toEqual(['brush-rail', 'history']);
    // The frame rate's slider took the transport's line on 390 px: it is behind «⋯».
    // …and at the row's far end the onion skin and the sound: both are the strip's (owner, 2026-10-07).
    expect(cut.panels.rows).toEqual([['add-frame', 'transport', 'spring', 'onion', 'audio'], ['timeline']]);
    expect(cut.panels.right).toEqual([]);
    expect(cut.panels.float).toEqual([]);
  });

  it('«⋯» holds what is neither a tool, nor the sound, nor a frame key: frames, the toon, the studio', () => {
    const cut = phoneLayout(base, base, keep);
    expect(cut.more).toEqual([
      { id: 'frames', items: ['fps'] },
      { id: 'toon', items: ['save', 'export', 'saved'] },
      { id: 'studio', items: ['settings', 'manual', 'fullscreen'] },
    ]);
  });

  it('the frame keys are nowhere on a phone: the strip’s own menu, a held finger away, does their work', () => {
    let layout = movePanelItem(base, 'drafts', 'top', 0);
    for (const id of ['merge', 'paste', 'copy', 'delete-frame']) layout = movePanelItem(layout, id, 'top', 0);
    const cut = phoneLayout(layout, base, keep);
    const drawn = [...all(cut), ...cut.panels.top, ...cut.panels.rows.flat(), ...cut.tools];
    for (const id of ['merge', 'paste', 'copy', 'delete-frame']) expect(drawn).not.toContain(id);
    expect(cut.more.find((group) => group.id === 'toon')?.items).toEqual(['save', 'export', 'drafts', 'saved']);
    const bare = phoneLayout({ ...base, top: ['publish', 'settings'] }, base, keep);
    expect(bare.more.map((group) => group.id)).toEqual(['frames', 'studio']);
    // No sound and no onion skin placed, no keys for them.
    expect(bare.panels.rows[0]).toEqual(['add-frame', 'transport']);
  });

  it('a tool key pressed again opens the brush, as on toonop’s desktop — under any arrangement', () => {
    expect(toolOpensBrush(phoneLayout(base, base, keep).panels, 'pencil')).toBe(true);
    expect(toolOpensBrush(phoneLayout(defaultPanels(), base, keep).panels, 'pencil')).toBe(true);
  });

  it('a tool that is not drawn takes no room in the row', () => {
    const cut = phoneLayout(base, base, keep);
    expect([...cut.panels.top, ...cut.tools]).not.toContain('tool:pipette');
  });

  it('an arrangement with columns is drawn the same way; its boxes are behind the colour key and the tool keys', () => {
    const layout = defaultPanels();
    const cut = phoneLayout(layout, base, keep);
    expect(cut.panels.left).toEqual(base.left);
    expect(cut.panels.rows[1]).toEqual(['timeline']);
    expect(cut.panels.top.slice(0, 3)).toEqual(['publish', 'more', 'spring']);
    expect(cut.panels.top.at(-1)).toBe('color-key');
    for (const id of ['palette', 'color', 'brush', 'brush-sizes', 'brush-key', 'transport', 'timeline', 'history', 'spring', 'audio']) {
      expect(all(cut)).not.toContain(id);
    }
    expect(all(cut)).toContain('settings');
  });

  it('lying down the sidebar is too short for undo and redo: they go to the row, which has the width', () => {
    const cut = phoneLayout(base, base, { ...keep, tall: false });
    expect(cut.panels.left).toEqual(['brush-rail']);
    expect(cut.panels.top.slice(0, 3)).toEqual(['publish', 'more', 'history']);
  });

  it('lying down the height is the canvas’s: the transport, the onion skin and the sound stand in the row, the bar is the strip alone', () => {
    // Owner, 2026-10-07: «кнопки будут сверху, место позволяет, а инструменты объединены в один».
    const cut = phoneLayout(base, base, { ...keep, tall: false, room: 12 });
    expect(cut.panels.top).toEqual(['publish', 'more', 'history', 'spring:lead', 'add-frame', 'transport', 'onion', 'audio', 'spring', 'tool:pencil', 'tool:eraser', 'tools', 'color-key']);
    expect(cut.panels.rows).toEqual([['timeline']]);
    expect(cut.tools).toEqual(['tool:feather', 'tool:mega-eraser', 'tool:drag', 'tool:lasso']);
    // «Добавить кадр», three of the transport, the onion skin and the sound take the row's room with undo and redo.
    expect(editorUi).toContain('keys: tall ? 2 : 10');
    // In the middle of the row (owner: «сделай их по центру»): a spring on either side.
    expect(editorUi).toContain("{:else if id === 'spring' || id === 'spring:lead'}");
    // The strip folded, nothing is left in the bar but its fold key.
    expect(editorUi).toContain('const barBare = $derived(compact && !tall && stripFolded);');
    expect(editorUi).toContain('class:bare={barBare}');
    // …and the sheet is fitted to the whole stage: no bar to keep clear of.
    expect(editorUi).toContain('style:--stage-under={!panelFolded && !barBare && panels.rows.length > 0 ?');
  });

  it('what is on the shelf stays there', () => {
    const layout = movePanelItem(base, 'export', 'hidden');
    const cut = phoneLayout(movePanelItem(layout, toolItem('eraser'), 'hidden'), base, keep);
    expect(all(cut)).not.toContain('export');
    expect(cut.panels.top).not.toContain('tool:eraser');
  });

  it('with no publish placed the row starts at «⋯»', () => {
    const cut = phoneLayout(movePanelItem(base, 'publish', 'hidden'), base, keep);
    expect(cut.panels.top[0]).toBe('more');
  });
});

describe('the essentials of a preset', () => {
  it('Toonop and Toonio: the pencil and the eraser — the pipette sits by the palette', () => {
    expect(phoneTools(presetUx('toonop'))).toEqual(['pencil', 'eraser']);
    expect(phoneTools(presetUx('toonio'))).toEqual(['pencil', 'eraser']);
  });

  it('Multator keeps its pipette: there it is a key of the tools', () => {
    expect(phoneTools(presetUx('multator'))).toEqual(['pencil', 'eraser', 'pipette']);
  });
});

describe('the step is the desktop or the phone', () => {
  const view = { w: 820, h: 1180 };
  it('a tablet standing up, with room for the canvas, is the desktop', () => {
    expect(pickStep('phone', { w: 700, h: 900 }, view)).toBe('full');
    expect(pickStep('full', { w: 891, h: 649 }, { w: 1280, h: 800 })).toBe('full');
  });

  it('a screen that leaves the canvas no room is the phone — there is no step between', () => {
    // 768×1024 at 200 % text: the columns left the canvas 0 px.
    expect(pickStep('full', { w: 0, h: 627 }, { w: 768, h: 1024 })).toBe('phone');
    expect(pickStep('full', { w: 500, h: 380 }, { w: 768, h: 1024 })).toBe('phone');
    expect(pickStep('full', { w: 380, h: 700 }, { w: 390, h: 844 })).toBe('phone');
  });

  it('a narrow viewport lowers the width floor to 45vw', () => {
    expect(pickStep('full', { w: 320, h: 600 }, { w: 700, h: 900 })).toBe('full');
  });

  it('stepping up needs the floor plus the hysteresis, stepping down does not', () => {
    const v = { w: 800, h: 1280 };
    expect(pickStep('full', { w: 360 + HYSTERESIS / 2, h: 600 }, v)).toBe('full');
    expect(pickStep('phone', { w: 360 + HYSTERESIS / 2, h: 600 }, v)).toBe('phone');
    expect(pickStep('phone', { w: 360 + HYSTERESIS, h: 600 }, v)).toBe('full');
  });
});

describe('the studio draws one markup, given the arrangement', () => {
  it('the step is picked from the editor box by the user’s own arrangement', () => {
    expect(editorUi).toContain('bind:clientWidth={boxW}');
    expect(editorUi).toContain('bind:clientHeight={boxH}');
    expect(editorUi).toContain("const full = { w: boxW - fullBase('left') - fullBase('right'), h: boxH - bar - top };");
    expect(editorUi).toContain('step = pickStep(was, full, view);');
    expect(editorUi).toMatch(/class:compact=\{compact\}/);
  });

  it('a phone’s cut is toonop’s arrangement, and everything is drawn from `panels`', () => {
    expect(editorUi).toContain('const cut = $derived(\n    compact\n      ? phoneLayout(editor.panels, presetPanels(DEFAULT_PRESET), {');
    expect(editorUi).toContain('const panels = $derived(cut?.panels ?? editor.panels);');
    const markup = editorUi.slice(editorUi.indexOf('<div\n  class="editor studio"'), editorUi.indexOf('<style>'));
    expect(markup).not.toContain('editor.panels');
    // No branch of the markup is the desktop's alone — only the bar's stored height and its divider.
    expect(markup).not.toMatch(/\{#if !compact/);
  });

  it('the tabs, their dock and their order are gone', () => {
    for (const gone of ['class="dock"', 'mini-transport', 'tab-window', 'tabOrder', 'openTab']) expect(editorUi).not.toContain(gone);
    expect(ru.editor.tab).toBeUndefined();
    expect(ru.editor.tabs).toBeUndefined();
    expect(ru.settings.tabs_hint).toBeUndefined();
  });

  it('«⋯» is a disclosure: a key in the row, a window of named keys, Esc and a second press close it', () => {
    expect(ru.editor.more).toBe('Ещё');
    expect(editorUi).toMatch(/\{:else if id === 'more'\}[\s\S]*?aria-expanded=\{moreOpen\}[\s\S]*?aria-controls=\{moreOpen \? 'more-window' : undefined\}/);
    expect(editorUi).toMatch(/\{#if cut && moreOpen\}[\s\S]*?id="more-window"[\s\S]*?\{#each cut\.more as group \(group\.id\)\}[\s\S]*?\{t\(`editor\.more_group\.\$\{group\.id\}`\)\}[\s\S]*?\{@render slot\(group\.items\)\}/);
    expect(ru.editor.more_group).toEqual({ frames: 'Кадры', toon: 'Мульт', studio: 'Студия' });
    expect(editorUi).toMatch(/key === 'Escape' && moreOpen && !modalOpen/);
  });

  it('the key for the other tools wears the tool in hand, and lists them by name', () => {
    expect(ru.editor.tools_more).toBe('Другие инструменты');
    expect(editorUi).toMatch(/\{:else if id === 'tools'\}[\s\S]*?<PopKey[\s\S]*?active=\{!!held\}[\s\S]*?<Icon name=\{held \? \(toolSpec\(held\)\?\.icon \?\? 'tools'\) : 'tools'\} \/>[\s\S]*?class="more-keys tool-list"[\s\S]*?\{@render slot\(cut\?\.tools \?\? \[\]\)\}/);
  });

  it('a finger gets no hand tool: two fingers move the sheet', () => {
    expect(editorUi).toContain("const touch = matchMedia('(pointer: coarse)').matches;");
    expect(editorUi).toContain("&& !(tool === 'drag' && touch)");
    const cut = phoneLayout(base, base, { ...keep, drawn: (tool) => tool !== 'pipette' && tool !== 'drag' });
    expect([...cut.panels.top, ...cut.tools, ...all(cut)]).not.toContain('tool:drag');
  });

  it('a key of «⋯» keeps its icon off the edge', () => {
    expect(editorUi).toMatch(/\.more-keys > :global\(\.key\) > :global\(svg\),[^{]*\{\s*flex: none;/);
    // Under `.editor`: an icon key's own `padding: 0` is as heavy and comes later.
    expect(editorUi).toMatch(/\n  \.editor \.more-keys > :global\(\.key\[aria-label\]\),\s*\.editor \.more-keys > :global\(\.pop-key\) > :global\(\.key\) \{[^}]*padding: 0\.3rem 0\.85rem 0\.3rem 1\.1rem;/);
  });

  it('every key of «⋯» says its name — a tool that opens its brush too — in cells of one size', () => {
    const named = editorUi.match(/\n  ([^{}]*)\{\s*content: attr\(aria-label\);/)?.[1] ?? '';
    expect(named).toContain('.more-keys > :global(.key[aria-label])::before');
    expect(named).toContain('.more-keys > :global(.pop-key) > :global(.key)::before');
    expect(editorUi).toMatch(/\.more-keys \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    // The frame rate is a slider with no word on it: its title is its caption.
    expect(editorUi).toMatch(/\.more-keys > \.fps-inline::before \{\s*content: attr\(title\);/);
  });

  it('the canvas hint stands over the bottom bar, not under it: the wrap runs on beneath the bar', async () => {
    const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
    expect(canvas).toMatch(/\n  \.hint \{[^}]*bottom: calc\(12px \+ var\(--stage-under, 0px\)\);/);
    expect(editorUi).toMatch(/\.stage\.narrow :global\(\.hint\) \{[^}]*bottom: calc\(var\(--stage-under, 0px\) \+/);
  });

  it('a press anywhere else closes «⋯» and the sound sheet, as it closes a key’s box: one thing open at a time', () => {
    const away = editorUi.slice(editorUi.indexOf('// On a phone a press anywhere else closes what is open'), editorUi.indexOf('function onMoreKey('));
    expect(away).toContain("window.addEventListener('pointerdown', away, true);");
    expect(away).toContain('if (moreOpen && !tabWindow?.contains(hit) && !moreKey?.contains(hit)) moreOpen = false;');
    expect(away).toContain("if (audioOpen && !hit.closest('.audio-plate, dialog') && !audioKey?.contains(hit)) audioOpen = false;");
  });

  it('a phone’s bar is as tall as its rows: one layer stands whole, many scroll in the strip; no divider to drag', () => {
    expect(editorUi).toContain('style={!panelFolded && !compact && !editor.arranging ? `height: ${panelHeight}px` : undefined}');
    expect(editorUi).toContain('{#if !barFolded && !compact}');
    expect(editorUi).toMatch(/\.studio\.compact \.panel :global\(\.timeline\),\s*\.studio\.compact \.panel :global\(\.board\) \{\s*height: auto;/);
    expect(editorUi).toMatch(/\.studio\.compact \.panel :global\(\.board\) \{\s*max-height: 34dvh;/);
  });

  it('the thickness slider keeps the finger: the browser may not take the drag for a pan', async () => {
    const railUi = await Bun.file(new URL('./BrushRail.svelte', import.meta.url)).text();
    expect(railUi).toMatch(/\.well input \{[^}]*touch-action: none;/);
  });

  it('lying down the slider is as long as the stage has room for, not as the screen is tall', () => {
    // 100dvh − 16rem guessed the bars: on 740×320 the card was cut and the knob of a thin brush was under the cut.
    expect(editorUi).toContain('style:--stage-h={compact ? `${stageHeight}px` : undefined}');
    expect(editorUi).toMatch(/\.studio\.compact:not\(\.tall\) \.left\.sidebar :global\(\.brush-rail\) \{\s*--rail-h: clamp\(2rem, var\(--stage-h\) - 4rem, 9rem\);/);
  });

  it('lying down «⋯» is a line to a group — its name, then its keys — and as wide as they are', () => {
    // Stacked across 48rem the three groups were 265 px in a stage of 191: a scroll, a slider 700 px long.
    expect(editorUi).toMatch(/\.studio:not\(\.tall\) \.more-window \{[^}]*display: grid;[^}]*grid-template-columns: auto 1fr;[^}]*width: fit-content;[^}]*max-width: calc\(100% - 1rem\);/);
    expect(editorUi).toMatch(/\.studio:not\(\.tall\) \.more-keys:not\(\.tool-list\) \{[^}]*display: flex;/);
    expect(editorUi).not.toContain('repeat(4, minmax(0, 1fr))');
  });

  it('a phone folds the strip alone — the transport stays — and lying down starts folded', () => {
    expect(editorUi).toContain('const stripFolded = $derived(compact && (stripShut ?? (!tall || boxH < 30 * rem)));');
    expect(editorUi).toContain("{#if !(stripFolded && row.includes('timeline'))}");
    expect(editorUi).toContain('onclick={() => (compact ? (stripShut = !stripFolded) : editor.togglePanel())}');
  });

  it('a phone’s keys stand on the tap floor: 200 % text does not make three rows of them', () => {
    expect(editorUi).toMatch(/\.studio\.compact \.top,\s*\.studio\.compact \.left\.sidebar,\s*\.studio\.compact \.panel \.row:not\(\.strip-row\) \{\s*--key-h: var\(--tap\);/);
  });

  it('the zoom window with no room under the sidebar goes to the far top corner, not beside the sidebar', () => {
    expect(editorUi).toContain('class:zoom-corner={compact && !scaleUnder}');
    expect(editorUi).toMatch(/\.stage\.zoom-corner > \.scale-window \{[^}]*inset: var\(--zoom-inset\) var\(--zoom-inset\) auto auto;/);
    // The site's first-run note starts under it (apps/web, `--zoom-foot`).
    expect(editorUi).toMatch(/\.stage\.zoom-corner \{[^}]*--zoom-foot: calc\(var\(--zoom-inset\) \+ var\(--tap\)/);
  });

  it('on a phone the sheet is fitted under the sidebar and the zoom window: a bigger sheet is worth it (owner, 2026-10-07)', () => {
    expect(editorUi).toContain("data-over-sheet={folded('left') || compact ? undefined : ''}");
    expect(editorUi).toContain('class="scale-window" data-over-sheet={compact ? undefined : \'\'}');
  });

  it('the sidebar stands in the middle of the stage’s height; the zoom window takes the corner under it only where half the rest holds it', () => {
    expect(editorUi).toMatch(/\.studio\.compact \.left\.sidebar \{[^}]*align-self: center;/);
    expect(editorUi).toContain('sideH[id] + (compact ? 2 : 1) * (SIDE_GAP + 5.5) * rem <= stageHeight');
  });

  it('the sidebar is the fixed one on a phone, under any preset', () => {
    expect(editorUi).toContain("id === 'left' && (compact || !!editor.ux.leftFixed)");
  });
});
