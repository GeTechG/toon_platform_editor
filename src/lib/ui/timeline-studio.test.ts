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
  it('add and delete frame sit on the studio transport, not beside the timeline', () => {
    // Reference: ⏮ ⏴ ▶ ⏵ ⏭ + × 👻 fps … — the frame keys are part of the bar.
    const studio = defaultPanels();
    expect(studio.rows[0]).toContain('add-frame');
    expect(studio.rows[0]).toContain('delete-frame');
    expect(studio.rows[1]).toEqual(['timeline']);
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
    // electric while it is hovered, focused or being dragged — and the drag
    // keeps it lit after the pointer has left the 9px band.
    expect(editorUi).toContain('class="side-edge');
    expect(editorUi).toMatch(/\.side-edge \{[^}]*background: transparent/s);
    expect(editorUi).toMatch(
      /\.side-resizer:hover,\s*\.side-edge\.dragging \.side-resizer \{[^}]*var\(--electric\)/s,
    );
    expect(editorUi).toContain('class:dragging={');
  });

  it('the fold handle is a key-shaped tab growing out of the panel edge', () => {
    // The editor speaks in physical keys: 7px radius, a 2px key shadow, sky on
    // hover. A tab is one of them, rounded on the stage side and square where
    // it meets the panel. The key is drawn with `--edge`, not the divider
    // hairline: a key you cannot see does not read as a key (WCAG 1.4.11).
    expect(editorUi).toContain('editor.toggleSide(');
    const fold = editorUi.match(/\n  \.fold \{[^}]*\}/s)?.[0] ?? '';
    expect(fold).toContain('height: var(--key-h)');
    expect(fold).toContain('box-shadow: 0 2px 0 var(--edge)');
    expect(fold).not.toContain('border-radius: 50%');
    expect(editorUi).toMatch(/\.at-left \.fold \{[^}]*border-radius: 0 var\(--r-sm\) var\(--r-sm\) 0/s);
    expect(editorUi).toMatch(/\.fold:hover \{[^}]*background: var\(--sky\)/s);
  });

  it('the tab that brings a folded column back waits pale at the screen edge', () => {
    expect(editorUi).toMatch(/\.side-edge\.folded \.fold \{[^}]*opacity: 0\.55/s);
    expect(editorUi).toMatch(/\.side-edge\.folded \.fold:hover[^{]*\{[^}]*opacity: 1/s);
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
    // thing that is meant to stick out: 15px of tab plus its focus ring (3px
    // at 2px offset) have to clear that clip, or the arrow loses its head.
    expect(editorUi).toMatch(/\.studio \.panel \{[^}]*overflow-clip-margin: 20px/s);
    expect(editorUi).toContain("chevron-down");
    expect(editorUi).toContain("chevron-up");
  });

  it('the seam shows itself only under the cursor, like the side ones', () => {
    expect(editorUi).toMatch(
      /\.resizer:hover,\s*\.panel\.dragging \.resizer \{[^}]*var\(--electric\)/s,
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

describe('the strip only pays for the cells it shows', () => {
  // Sixty frames meant sixty live 2D contexts, of which a 1280px screen shows
  // about twenty; the format allows 4096. A canvas is free until `getContext`,
  // so the cell waits until it is in view. Measured after: 61 cells, 23 drawn.
  it('a cell thumbnail takes its context when it comes into view', async () => {
    const thumb = await Bun.file(new URL('./LayerThumb.svelte', import.meta.url)).text();
    expect(thumb).toContain('IntersectionObserver');
    expect(thumb).toContain('!onScreen');
    // No observer in the engine is a reason to draw, not a reason to go blank.
    expect(thumb).toContain('onScreen = true;');
  });
});
