import { describe, expect, it } from 'bun:test';

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
    // ...and the studio does not also offer the popup, which would be a
    // second copy of the same list.
    expect(editorUi).toContain('editor.features.layers && !studio');
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
    expect(editorUi).toContain('class="panel" style={studio ?');
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
    const transport = editorUi.slice(
      editorUi.indexOf('aria-label="Просмотр и экспорт"'),
      editorUi.indexOf('aria-label="Кисть"'),
    );
    expect(transport).toContain('onAddFrame');
    expect(transport).toContain('editor.removeActiveFrame()');
  });
});
