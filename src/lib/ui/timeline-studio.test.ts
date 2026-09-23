import { describe, expect, it } from 'bun:test';
import { allPlaced, defaultPanels } from './panels';
import { t } from '../i18n';

const rows = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();
const timeline = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

describe('one layer list, two placements', () => {
  it('the rows and their operations live in one component', () => {
    expect(rows).toContain('editor.toggleLayerHidden(');
    expect(rows).toContain('editor.moveLayerTo(');
    expect(rows).toContain('editor.addLayerAtActive(');
    expect(rows).toContain('editor.removeActiveLayer()');
  });

  it('every control the reference puts in a row is in the row, not a footer', () => {
    // Reference row: eye · name · ⇕ · ×, with «+ Слой» heading the column.
    expect(rows).toContain("t('layer.remove_title')");
    expect(t('layer.remove_title')).toBe('Удалить слой');
    expect(rows).toContain('class="add-layer"');
    expect(rows).not.toContain('<footer>');
    // Deleting acts on the row you pressed, not on whichever layer was active.
    expect(rows).toContain('removeLayer(layerIndex)');
  });

  it('the timeline is the only place the rows live', () => {
    expect(timeline).toContain('<LayerRows');
    // No popup around a second copy of the same list — in any layout.
    expect(allPlaced(defaultPanels())).not.toContain('layers');
    expect(editorUi).not.toContain('LayersPanel');
  });
});


describe('the names and the cells scroll together', () => {
  it('a scroll in either scroller moves the other', () => {
    expect(timeline).toContain('onscrollcapture={syncRowScroll}');
    expect(timeline).toContain('[data-layer-list]');
    expect(rows).toContain('data-layer-list');
  });
});

describe('studio timeline grid', () => {
  it('is one layer-by-frame grid, in the bar layout as well', () => {
    expect(timeline).toContain('<LayerThumb');
    // The one-strip-of-frames version is gone: layers are always on the
    // timeline, so the bar layout gets the same grid, capped in height.
    expect(timeline).not.toContain('class="scroller"');
    expect(timeline).not.toContain('<FrameThumb');
  });

  it('a cell click carries the modifier that decides the selection', () => {
    expect(timeline).toContain('editor.selectCell(');
    expect(timeline).toContain("'range'");
    expect(timeline).toContain("'toggle'");
  });

  it('marks the active cell, the selection, onion frames and the copied block', () => {
    expect(timeline).toContain('class:active');
    expect(timeline).toContain('class:selected');
    expect(timeline).toContain('editor.onionSkinLayers');
    expect(timeline).toContain('editor.copiedFrom');
  });

  it('says the selection out loud, not only in the dashed ring', () => {
    // `aria-current` names the one cell the editor is on. Being part of the
    // block a copy or a delete is about to take is a second state, and it was
    // drawn and nothing else — a dashed outline a screen reader cannot see.
    // Every other multi-state control in the package (the tool key, the brush
    // sizes, the swatches) says `aria-pressed`; the cell is the one that did
    // not.
    expect(timeline).toMatch(/aria-pressed=\{isSelected\(/);
  });

  it('tells those states apart without colour (WCAG 1.4.1)', () => {
    // Active is a solid ring, the selection a dashed one; onion and copied
    // frames carry a glyph in the frame-number header.
    expect(timeline).toContain('border-style: dashed');
    expect(timeline).toContain('aria-current');
  });
});

describe('layer column divider', () => {
  it('a splitter sits between the layer column and the frames', () => {
    expect(timeline).toContain('class="col-resizer"');
    expect(timeline).toContain('role="separator"');
    expect(timeline).toContain('aria-orientation="vertical"');
    expect(timeline).toContain('cursor: ew-resize');
  });

  it('the column takes the width the drag hands out, between a floor and a ceiling', () => {
    expect(timeline).toContain('onpointerdown={onColDown}');
    expect(timeline).toContain('onpointermove={onColMove}');
    expect(timeline).toContain('COL_MIN');
    expect(timeline).toContain('COL_MAX');
  });

  it('narrows down to the icons, never into the eye', () => {
    // The floor is the row without its name: eye, tag, handle, delete.
    expect(timeline).toContain('const COL_MIN = 128;');
  });

  it('the arrows resize it too, so no pointer drag is required (WCAG 2.5.7)', () => {
    expect(timeline).toContain('onkeydown={onColKey}');
    expect(timeline).toContain("case 'ArrowLeft'");
    expect(timeline).toContain("case 'ArrowRight'");
  });
});

describe('bottom panel divider', () => {
  it('the divider sits on the panel, dragging and answering the arrows', () => {
    expect(editorUi).toContain('role="separator"');
    expect(editorUi).toContain('editor.setPanelHeight(');
    expect(editorUi).toContain('onpointermove={onDividerMove}');
    expect(editorUi).toContain("case 'ArrowUp'");
  });

  it('never grows past three quarters of the viewport', () => {
    expect(editorUi).toContain('0.75');
  });

  it('is as wide a target as the reference resizer, straddling the panel edge', () => {
    // Reference #resizer: position absolute, top -8px, height 16px — half of
    // it hangs over the canvas, so the grab area is not the 1px border.
    const resizer = editorUi.match(/\.resizer \{[^}]*\}/)?.[0] ?? '';
    expect(resizer).toContain('position: absolute');
    expect(resizer).toContain('top: -8px');
    expect(resizer).toContain('height: 16px');
  });

  it('drags without painting the interface blue', () => {
    // Reference .draw carries user-select: none, so a resize never selects
    // labels; the fields you do type in keep their selection.
    const editorRule = editorUi.match(/\n  \.editor \{[^}]*\}/)?.[0] ?? '';
    expect(editorRule).toContain('user-select: none');
    expect(editorUi).toMatch(/\.editor input \{[^}]*user-select: text/s);
  });

  it('the rows keep room for the paint outside their boxes', () => {
    // A scroll box clips at its padding edge: without this the active ring
    // and the key shadows are shaved off at the panel's edge.
    expect(editorUi).toMatch(/\.studio \.toolbar \{[^}]*padding: var\(--bleed\);[^}]*margin: calc\(-1 \* var\(--bleed\)\);/s);
    // The token is what a control paints outside its box — the focus ring.
    expect(editorUi).toMatch(/--bleed: 6px;/);
  });

  it('the floor grows with every row the arrangement adds', () => {
    // 151px is written for a strip and one row; a third row needs its own
    // height or it is cut off at the bottom edge.
    expect(editorUi).toContain('editor.panels.rows.length - 2) * PANEL_ROW_STEP');
  });

  it('the panel owns the height and the timeline takes what is left of it', () => {
    // The whole bar resizes; the timeline is the row that grows with it, so
    // the grid gains rows and frames instead of the buttons drifting apart.
    // (arrange mode lets the bar size to its contents, hence the second term)
    expect(editorUi).toContain('style={!panelFolded && !editor.arranging ?');
    expect(editorUi).toContain('height: ${panelHeight}px');
    expect(timeline).not.toContain('editor.timelineHeight');
    expect(timeline).toContain('height: 100%');
  });
});


describe('copy, paste and merge on the studio transport', () => {
  it('has all three buttons, the two that need a buffer disabled without one', () => {
    expect(editorUi).toContain('editor.copySelection()');
    expect(editorUi).toContain('editor.pasteSelection()');
    expect(editorUi).toContain('editor.mergeSelection()');
    expect(editorUi).toContain('disabled={!editor.canPasteCells}');
    expect(editorUi.match(/disabled=\{!editor\.canPasteCells\}/g)).toHaveLength(2);
  });

  it('C and V drive the cell selection; M is the palette where the preset has a quick one', () => {
    // One timeline for everybody, so the clipboard is the selection always.
    expect(editorUi).toContain('editor.copySelection();');
    expect(editorUi).toContain('editor.pasteSelection();');
    // M keeps Multator's meaning, decided by the profile, not by a layout.
    expect(editorUi).toContain('quickPalette ? editor.togglePalette() : editor.mergeSelection()');
  });

  it('Shift with the arrows extends the selection instead of moving the cell', () => {
    expect(editorUi).toContain("editor.selectCell(");
    expect(editorUi).toContain("'range'");
  });
});


describe('frame buttons follow the reference bar', () => {
  it('add frame sits on the studio transport; the cell keys wait on the shelf', () => {
    const studio = defaultPanels();
    expect(studio.rows[0]).toContain('add-frame');
    for (const id of ['delete-frame', 'copy', 'paste', 'merge']) {
      expect(studio.hidden).toContain(id);
    }
    expect(studio.rows[1]).toEqual(['timeline']);
  });
});

describe('the frame menu on a right press', () => {
  it('a right press on a cell opens the menu instead of the browser one', () => {
    expect(timeline).toContain('oncontextmenu={(e) => openMenu(e, i, layerIndex)}');
    expect(timeline).toContain('role="menu"');
  });

  it('the menu runs the same operations as the keys', () => {
    for (const call of [
      'editor.addFrameAfterActive()',
      'editor.removeActiveFrame()',
      'editor.copySelection()',
      'editor.pasteSelection()',
      'editor.mergeSelection()',
    ]) {
      expect(timeline).toContain(call);
    }
    expect(timeline).toContain('disabled={!editor.canPasteCells}');
  });

  it('a cell outside the selection becomes the selection first', () => {
    expect(timeline).toMatch(/if \(!isSelected\(frame, layer\)\) \{\s*editor\.selectCell\(frame, layer\)/);
  });
});

describe('side panel dividers', () => {
  it('both side columns resize from their inner edge, by drag or by arrow', () => {
    expect(editorUi).toContain('aria-orientation="vertical"');
    expect(editorUi).toContain('editor.setSideWidth(');
    expect(editorUi).toContain("case 'ArrowLeft'");
    expect(editorUi).toContain("case 'ArrowRight'");
    expect(editorUi).toContain('class="side-resizer"');
  });

  it('the seam shows itself only under the cursor, and stays lit for the whole drag', () => {
    // No hairline down the stage: the tab marks the edge. The seam lights up
    // red while it is hovered, focused or being dragged — and the drag
    // keeps it lit after the pointer has left the 9px band.
    expect(editorUi).toContain('class="side-edge');
    expect(editorUi).toMatch(/\.side-edge \{[^}]*background: transparent/s);
    expect(editorUi).toMatch(
      /\.side-resizer:hover,\s*\.side-edge\.dragging \.side-resizer \{[^}]*var\(--accent\)/s,
    );
    expect(editorUi).toContain('class:dragging={');
  });

  it('the fold handle is a flat tab growing out of the panel edge', () => {
    // A flat key like the rest of the studio: white on the paper, the
    // sub-surface tone on hover, rounded on the stage side and square where it
    // meets the panel. No hard key under it (web-look «Студия в том же виде»).
    expect(editorUi).toContain('editor.toggleSide(');
    const fold = editorUi.match(/\n  \.fold \{[^}]*\}/s)?.[0] ?? '';
    expect(fold).toContain('height: var(--key-h)');
    expect(fold).not.toContain('box-shadow');
    expect(fold).not.toContain('border-radius: 50%');
    expect(editorUi).toMatch(/\.at-left \.fold \{[^}]*border-radius: 0 var\(--r-sm\) var\(--r-sm\) 0/s);
    expect(editorUi).toMatch(/\.fold:hover \{[^}]*background: var\(--sub\)/s);
  });

  it('the tab that brings a folded column back waits pale at the screen edge', () => {
    // Pale is the fill, not the tab: fading the tab itself took the `--edge`
    // outline down to 1.8:1 and the arrow with it (WCAG 1.4.11).
    expect(editorUi).toMatch(/\.side-edge\.folded \.fold \{\n\s*background: color-mix\(in srgb, var\(--canvas\) 55%/s);
    expect(editorUi).toMatch(/\.side-edge\.folded \.fold:focus-visible \{\n\s*background: var\(--sub\)/s);
    expect(editorUi).not.toMatch(/\.fold[^{]*\{[^}]*opacity:/s);
  });

  it('a folded column is a bare strip at the screen edge, with the circle still on it', () => {
    expect(editorUi).toMatch(/\.studio \.left\.collapsed,\n  \.studio \.right\.collapsed \{[^}]*padding: 0/s);
    expect(editorUi).not.toContain('class="expand"');
  });

  it('the stored width drives the column, and the phone layout ignores it', () => {
    expect(editorUi).toContain('width: ${');
    expect(editorUi).toMatch(/@media \(max-width: 40rem\)[^]*width: auto !important/);
  });
});

describe('side panels reflow instead of stretching', () => {
  it('the tool keys fill the column in even columns, one when it is narrow', () => {
    expect(editorUi).toMatch(/\.studio \.left,[^{]*\{[^}]*repeat\(auto-fit, minmax\(min\(/s);
    // A key may not hold a 44px floor open in a column narrower than that.
    expect(editorUi).toMatch(/\.studio \.left > :global\(\.key\)[^}]*min-width: 0/s);
  });

  it('the history keys reflow with them in a column, and stay a row elsewhere', () => {
    expect(editorUi).toMatch(/\.studio \.left \.history,[^{]*\{[^}]*repeat\(auto-fit/s);
    expect(editorUi).toMatch(/\n  \.history \{[^}]*display: flex/s);
  });

  it('a wider palette column widens the palette itself', () => {
    expect(editorUi).toMatch(/\.studio \.right :global\(\.box\) \{[^}]*width: 100%/s);
  });
});

describe('four surfaces, not one field', () => {
  it('the worktable is a tone below the panels, so the canvas floats on it', () => {
    // DESIGN §: depth comes from tonal plates, not shadows. The chrome keeps
    // the paper it always had; the table the drawing sits on steps down.
    expect(editorUi).toMatch(/--table: #/);
    expect(editorUi).toMatch(/\n  \.stage \{[^}]*background: var\(--table\)/s);
    expect(editorUi).toMatch(/\n  \.panel \{[^}]*background: var\(--paper\)/s);
  });

  it('each side panel closes with a hairline on the edge the canvas is on', () => {
    expect(editorUi).toMatch(/\.studio \.left \{[^}]*border-right: 1px solid var\(--hairline\)/s);
    expect(editorUi).toMatch(/\.studio \.right \{[^}]*border-left: 1px solid var\(--hairline\)/s);
    // The alternative layout swaps the columns, so it swaps the edges too.
    expect(editorUi).toMatch(/\.studio\.alt \.left \{[^}]*border-left: 1px solid var\(--hairline\)/s);
    expect(editorUi).toMatch(/\.studio\.alt \.right \{[^}]*border-right: 1px solid var\(--hairline\)/s);
  });
});

describe('the fold tab sits on a corner, not in mid-air', () => {
  it('rides at the top of the seam, level with the first key in the column', () => {
    const fold = editorUi.match(/\n  \.fold \{[^}]*\}/s)?.[0] ?? '';
    expect(fold).toContain('top: 1rem');
    expect(fold).not.toContain('top: 50%');
    // No -50% left anywhere in the tab's press travel.
    expect(editorUi).not.toMatch(/\.fold[^{]*\{[^}]*calc\(-50%/s);
  });
});

describe('the bottom panel folds like the sides', () => {
  it('its seam carries the same tab, lying on its side', () => {
    expect(editorUi).toContain('editor.togglePanel()');
    // The lip is as thick as the side tab is wide, and both are one pixel
    // over the 14px arrow: the tab is border-box and drops the border on the
    // side it leans against, so 14 would leave the arrow 13 and the panel
    // would paint over the pixel that sticks out.
    expect(editorUi).toMatch(/\.fold\.lying \{[^}]*height: 15px/s);
    expect(editorUi).toMatch(/\.fold \{[^}]*width: 15px/s);
    // Centred on its seam: at a corner it reads as a chip stuck to the
    // column above it rather than as the bar's own handle.
    expect(editorUi).toMatch(/\.fold\.lying \{[^}]*left: 50%/s);
    expect(editorUi).toMatch(/\.fold\.lying:hover \{[^}]*translate\(-50%/s);
    expect(editorUi).toMatch(/\.fold\.lying \{[^}]*width: var\(--key-h\)/s);
    // The panel clips what its rows paint outside it, and the tab is the one
    // thing that is meant to stick out. How much room that takes is arithmetic
    // — tab, ring, offset and the lift under the cursor — and `system-craft`
    // does the sum; here it is enough that a margin is cut at all.
    expect(editorUi).toMatch(/\.studio \.panel \{[^}]*overflow-clip-margin: \d+px/s);
    expect(editorUi).toContain("chevron-down");
    expect(editorUi).toContain("chevron-up");
  });

  it('the seam shows itself only under the cursor, like the side ones', () => {
    expect(editorUi).toMatch(
      /\.resizer:hover,\s*\.panel\.dragging \.resizer \{[^}]*var\(--accent\)/s,
    );
    expect(editorUi).not.toMatch(/\.resizer \{[^}]*3rem 2px no-repeat/s);
  });

  it('a phone has no folding at all, so it carries none of the tabs', () => {
    // The columns are rows there and the bar sizes to its contents; a tab
    // that folds nothing is a dead control.
    expect(editorUi).toMatch(/@media \(max-width: 40rem\)[^]*\.fold \{\n      display: none;/);
  });

  it('folded, the bar is a strip with the tab still on it and no toolbar behind it', () => {
    expect(editorUi).toContain('{#if !panelFolded}');
    expect(editorUi).toMatch(/\.panel\.collapsed \{[^}]*height: 0\.75rem/s);
  });
});

describe('the strip builds a window of frames', () => {
  // Fifteen hundred buttons with a canvas inside is what three hundred frames
  // on five layers came to; the browser laid every one of them out.
  it('builds the frames of the window, not every frame of the document', () => {
    expect(timeline).toContain('stripWindow(');
    expect(timeline).toContain('{#each built as i (i)}');
    expect(timeline).not.toContain('{#each frames as _, i (i)}');
  });

  it('stands spacers in for the frames it left out', () => {
    // The scrollbar has to be the length it would be with every cell in place.
    const spacers = timeline.match(/view\.(before|after)/g) ?? [];
    // Three rows share the window: the numbers, the cells and the wave.
    expect(spacers.length).toBeGreaterThanOrEqual(6);
  });

  it('scrolls to the active frame by arithmetic, not by looking for its cell', () => {
    expect(timeline).toContain('scrollToFrame(');
    expect(timeline).not.toContain('[data-frame="${index}"]');
  });
});

describe('the strip only pays for the cells it shows', () => {
  // Sixty frames meant sixty live 2D contexts, of which a 1280px screen shows
  // about twenty; the format allows 4096. A canvas is free until `getContext`,
  // so the cell waits until it is in view. Measured after: 61 cells, 23 drawn.
  it('a cell thumbnail takes its context when it comes into view', async () => {
    const thumb = await Bun.file(new URL('./LayerThumb.svelte', import.meta.url)).text();
    // One observer for the whole strip, not a pair per cell (`on-screen.ts`).
    expect(thumb).toContain('whenOnScreen(canvasEl');
    expect(thumb).toContain('!onScreen');
    expect(thumb).not.toContain('new IntersectionObserver');
  });

  it('a cell thumbnail redraws for its own cell, not for the document', async () => {
    // A write replaces the whole document holder, so every thumbnail on
    // screen hears every stroke; the cell it was drawn from is what says
    // whether this one has anything new to show — its stamp, since H and a
    // transform keep the cell and move the points (ninth audit).
    const thumb = await Bun.file(new URL('./LayerThumb.svelte', import.meta.url)).text();
    expect(thumb).toContain('const stamp = cellStamp(cell)');
    expect(thumb).toContain('stamp === painted');
  });
});

// Every visible cell was a tab stop of its own: getting past the strip took
// dozens of Tabs, and the arrows moved the active cell while focus stayed
// behind on the old one, so nothing said which frame was now current.
const stripSource = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();

describe('the strip is one stop on the Tab path', () => {
  const strip = stripSource;

  it('only the active cell is in the tab order', () => {
    expect(strip).toMatch(/tabindex=\{i === editor\.displayedFrame && layerIndex === editor\.activeLayer \? 0 : -1\}/);
  });

  it('focus follows the active cell, so its name is announced', () => {
    expect(strip).toContain(".querySelector<HTMLElement>('.cell.active')?.focus()");
  });
});

describe('the strip sees a frame added', () => {
  it('derives the count, not the array the write mutates in place', () => {
    // `#write` splices the frames array and swaps only the document object:
    // a derived array is the same reference, so the window never rebuilt.
    expect(timeline).not.toContain('$derived(editor.doc.layers[0].frames)');
    expect(timeline).toContain('$derived(editor.doc.layers[0].frames.length)');
  });
});

describe('the frame menu shows where the keys are', () => {
  it('a focused item keeps the ring, not only the hover tint', () => {
    // The tint is 7% ink on white — about 1.1:1 — and was the one sign of
    // focus while Shift+F10 and the arrows walked the menu (WCAG 2.4.7).
    const style = timeline.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';
    const focus = [...style.matchAll(/([^{}]*\.frame-menu button[^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)];
    expect(focus.length).toBeGreaterThan(0);
    for (const [, , body] of focus) {
      expect(body).not.toMatch(/outline:\s*(none|0)/);
    }
    expect(style).toMatch(/\.frame-menu button:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--accent\)/);
  });
});

describe('eighth audit: the frame menu keys', () => {
  const onMenuKey = timeline.match(/function onMenuKey[\s\S]*?\n  }/)?.[0] ?? '';
  it('Tab leaves the menu closed rather than walking out of an open one', () => {
    // A role="menu" is one stop: Tab closes it (WAI-ARIA menu pattern), or
    // focus wanders the page with the menu still floating over the strip.
    expect(onMenuKey).toMatch(/e\.key === 'Tab'[\s\S]*closeMenu\(true\)/);
  });
  it('Home and End reach the first and the last item', () => {
    expect(onMenuKey).toContain("'Home'");
    expect(onMenuKey).toContain("'End'");
  });
});

describe('ninth audit: focus stays in the strip', () => {
  const carry = timeline.match(/The strip is one Tab stop[\s\S]*?\n  \}\);/)?.[0] ?? '';

  it('deleting the focused frame hands focus to the new active cell', () => {
    // Delete on the last frame unmounted the focused cell and focus fell to
    // <body>: the next arrow or Space went nowhere a keyboard user could see.
    expect(carry).toContain('isConnected');
  });

  it('a preview does not throw focus out of the strip, nor walk it frame by frame', () => {
    // Disabling the cells for a preview dropped focus to <body>; the cells
    // ignore presses while playing anyway, so they only say so.
    expect(timeline).not.toMatch(/class="cell"[^>]*\sdisabled=\{editor\.playing\}/);
    expect(timeline).toContain('aria-disabled={editor.playing}');
    expect(carry).toContain('editor.playing');
  });
});

describe('ninth audit: the transport says when there is nowhere to go', () => {
  it('⏴ and ⏵ are off on a one-frame document, like ⏮ and ⏭', () => {
    // They wrapped onto the same frame: two live keys that did nothing,
    // next to two dimmed ones that said so.
    const transport = editorUi.match(/id === 'transport'[\s\S]*?<\/div>/)?.[0] ?? '';
    const steps = [...transport.matchAll(/disabled=\{([^}]*)\}\s*onclick=\{\(\) => editor\.selectFrame\(wrapIndex/g)];
    expect(steps.length).toBe(2);
    for (const [, rule] of steps) expect(rule).toContain('lastFrame === 0');
  });

  it('the shelf delete key is off where Delete would refuse, like the menu item', () => {
    const key = editorUi.match(/id === 'delete-frame'[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(key).toContain('!editor.canRemoveFrame');
  });
});

describe('ninth audit: a narrower strip keeps the active frame in view', () => {
  it('the scroll-into-view effect hears the strip width', () => {
    const effect = timeline.match(/Keep the active frame in view[\s\S]*?\n  \}\);/)?.[0] ?? '';
    expect(effect).toContain('void stripWidth');
  });
});

describe('tenth audit: the strip keeps what is active in view', () => {
  const effect = timeline.match(/Keep the active frame in view[\s\S]*?\n  \}\);/)?.[0] ?? '';

  it('the last frame is scrolled in with the row padding, ring and all', () => {
    expect(effect).toMatch(/scrollToFrame\(index, thumbWidth, GRID_GAP, strip\.scrollLeft, strip\.clientWidth, GRID_GAP\)/);
  });

  it('the active row is scrolled in under the sticky frame numbers', () => {
    // Arrows from the canvas walk the layers; with more rows than the panel
    // shows, the active one sat under the header or below the fold.
    const rowEffect = timeline.match(/Keep the active row in view[\s\S]*?\n  \}\);/)?.[0] ?? '';
    expect(rowEffect).toContain('editor.activeLayer');
    expect(rowEffect).toContain('scrollTop');
    expect(rowEffect).toMatch(/scrollToFrame\(/);
  });
});

describe('tenth audit: Home and End in the strip', () => {
  it('reach the first and the last frame without the letter keys', () => {
    // J and L do it, but they are letter keys, and the setting can turn those
    // off (WCAG 2.1.4); three hundred arrows is not a way to the end.
    const handler = timeline.match(/function onStripKey[\s\S]*?\n  }/)?.[0] ?? '';
    expect(handler).toContain("'Home'");
    expect(handler).toContain("'End'");
    expect(handler).toContain('preventDefault');
    expect(timeline).toContain('onkeydown={onStripKey}');
  });
});

describe('tenth audit: the frame menu on a touch screen', () => {
  it('a long press on a cell opens it — iOS sends no contextmenu', () => {
    // Delete, copy, paste and merge live only in this menu in «Toonop»; on an
    // iPhone a right press does not exist and a long press fires nothing.
    expect(timeline).toMatch(/pointerType === 'touch'[\s\S]*setTimeout/);
    expect(timeline).toContain('LONG_PRESS_MS');
    expect(timeline).toMatch(/onpointerup=\{cancelLongPress\}/);
    expect(timeline).toMatch(/onpointercancel=\{cancelLongPress\}/);
  });

  it('the press that opened the menu does not also select the cell', () => {
    const click = timeline.match(/function onCellClick[\s\S]*?\n  }/)?.[0] ?? '';
    expect(click).toContain('longPressed');
  });

  it('the cell gives no callout or text selection under a held finger', () => {
    const style = timeline.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';
    expect(style).toMatch(/\.cell\s*\{[^}]*-webkit-touch-callout:\s*none/);
    expect(style).toMatch(/\.cell\s*\{[^}]*user-select:\s*none/);
  });
});

describe('tenth audit: menu items are named without their key letter', () => {
  it('the key is a shortcut property, not part of the name', () => {
    // «Добавить кадрA» was the accessible name: the kbd text ran into it.
    const menu = timeline.match(/class="frame-menu"[\s\S]*?<\/div>/)?.[0] ?? '';
    const items = [...menu.matchAll(/<button role="menuitem"[\s\S]*?<\/button>/g)].map((m) => m[0]);
    expect(items.length).toBe(5);
    for (const item of items) {
      expect(item).toMatch(/aria-keyshortcuts="[^"]+"/);
      expect(item).toContain('<kbd aria-hidden="true">');
    }
  });
});

describe('tenth audit: a frame added at the end stays in view', () => {
  it('the strip is as wide as every frame whatever the window holds mid-update', () => {
    // The window swaps cells for a wider spacer in steps; a layout between
    // them saw a shorter row, the browser clamped the scroll to it, and the
    // frame just added sat several cells past the right edge.
    const head = timeline.match(/<div\s+class="head"[\s\S]*?>/)?.[0] ?? '';
    expect(head).toMatch(/style:min-width=\{`\$\{stripExtent\}px`\}/);
    expect(timeline).toMatch(/const stripExtent = \$derived\(frameTotal \* \(thumbWidth \+ GRID_GAP\) \+ GRID_GAP\)/);
  });
});

describe('tenth audit: the strip under forced colours', () => {
  const style = timeline.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';
  const forced = [...style.matchAll(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n  \}/g)].map((m) => m[1]).join('\n');

  it('the active cell keeps a mark of its own — its inset ring is a shadow, and shadows are dropped', () => {
    expect(forced).toMatch(/\.cell\.active\s*\{[^}]*border:\s*3px solid Highlight/);
  });

  it('the selection and the onion frames keep a system colour and their shape', () => {
    expect(forced).toMatch(/\.cell\.selected\s*\{[^}]*border-color:\s*Highlight/);
    expect(forced).toMatch(/\.num\.onion\s*\{[^}]*text-decoration-thickness/);
  });
});
