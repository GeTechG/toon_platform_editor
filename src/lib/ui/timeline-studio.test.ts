import { describe, expect, it } from 'bun:test';
import { defaultPanels } from './panels';

const rows = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();
const panel = await Bun.file(new URL('./LayersPanel.svelte', import.meta.url)).text();
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
    expect(rows).toContain('Удалить слой');
    expect(rows).toContain('class="add-layer"');
    expect(rows).not.toContain('<footer>');
    // Deleting acts on the row you pressed, not on whichever layer was active.
    expect(rows).toContain('removeLayer(layerIndex)');
  });

  it('the popup is chrome around those rows, and the studio timeline uses the same ones', () => {
    expect(panel).toContain('<LayerRows');
    expect(panel).not.toContain('editor.moveLayerTo(');
    expect(timeline).toContain('<LayerRows');
    // ...and the studio arrangement does not also place the popup, which
    // would be a second copy of the same list.
    expect(defaultPanels('studio').hidden).toContain('layers');
  });
});


describe('studio timeline grid', () => {
  it('keeps the bar layout as one strip and the studio as a layer-by-frame grid', () => {
    expect(timeline).toContain("editor.ux.layout === 'studio'");
    expect(timeline).toContain('<LayerThumb');
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

  it('the panel owns the height and the timeline takes what is left of it', () => {
    // The whole bar resizes; the timeline is the row that grows with it, so
    // the grid gains rows and frames instead of the buttons drifting apart.
    // (arrange mode lets the bar size to its contents, hence the third term)
    expect(editorUi).toContain('style={studio && !panelFolded && !editor.arranging ?');
    expect(editorUi).toContain('${panelHeight}px');
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

  it('C, V and M drive the selection in the studio; M stays the palette in the bar', () => {
    expect(editorUi).toContain('studio ? editor.copySelection() : editor.copyActiveFrame()');
    expect(editorUi).toContain('studio ? editor.pasteSelection() : editor.pasteFrame()');
    expect(editorUi).toContain('studio ? editor.mergeSelection() : editor.togglePalette()');
  });

  it('Shift with the arrows extends the selection instead of moving the cell', () => {
    expect(editorUi).toContain("editor.selectCell(");
    expect(editorUi).toContain("'range'");
  });
});


describe('frame buttons follow the reference bar', () => {
  it('add and delete frame sit on the studio transport, not beside the timeline', () => {
    // Reference: ⏮ ⏴ ▶ ⏵ ⏭ + × 👻 fps … — the frame keys are part of the bar.
    const studio = defaultPanels('studio');
    expect(studio.rows[1]).toContain('add-frame');
    expect(studio.rows[1]).toContain('delete-frame');
    expect(studio.rows[0]).toEqual(['timeline']);
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
    // The editor speaks in physical keys: 7px radius, hairline, 2px key
    // shadow, sky on hover. A tab is one of them, rounded on the stage side
    // and square where it meets the panel.
    expect(editorUi).toContain('editor.toggleSide(');
    const fold = editorUi.match(/\n  \.fold \{[^}]*\}/s)?.[0] ?? '';
    expect(fold).toContain('height: var(--key-h)');
    expect(fold).toContain('box-shadow: 0 2px 0 var(--hairline)');
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

  it('the history keys reflow with them', () => {
    expect(editorUi).toMatch(/\.studio \.history \{[^}]*repeat\(auto-fit/s);
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
    expect(editorUi).toMatch(/\.fold\.lying \{[^}]*height: 14px/s);
    // Centred on its seam: at a corner it reads as a chip stuck to the
    // column above it rather than as the bar's own handle.
    expect(editorUi).toMatch(/\.fold\.lying \{[^}]*left: 50%/s);
    expect(editorUi).toMatch(/\.fold\.lying:hover \{[^}]*translate\(-50%/s);
    expect(editorUi).toMatch(/\.fold\.lying \{[^}]*width: var\(--key-h\)/s);
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
