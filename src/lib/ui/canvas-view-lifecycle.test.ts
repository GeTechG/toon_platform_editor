import { describe, expect, it } from 'bun:test';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name} handler`);
  return match[0];
}

describe('the pointer lifecycle the canvas drives', () => {
  it('starts only a primary, non-playing, single active gesture and captures it', () => {
    const down = handler('onPointerDown');
    expect(down).toContain('editor.playing || !e.isPrimary || pointer.session');
    expect(down).toContain('setPointerCapture(e.pointerId)');
    expect(down).toContain('pointer.pointerDown(toPointerSample(e, true))');
    // The canvas hands the samples over and lets the brush choose; it no
    // longer decides for one by name.
    expect(source).not.toContain("=== 'toonio'");
    expect(source).toContain('rules: activeRules()');
    expect(source).not.toContain('coordinateScale');
    expect(source).not.toContain('documentScale');
  });

  it('hands every pointermove to the brush, coalesced samples and all', () => {
    const move = handler('onPointerMove');
    expect(move).toContain('pointer.pointerMove(toPointerSample(e, true))');
    // Which of the coalesced samples become points is the brush's rule.
    expect(source).toContain('!editor.settings.mouseMode');
  });

  it('commits existing geometry on pointerup without appending the up coordinate', () => {
    const up = handler('onPointerUp');
    expect(up).toContain('pointer.pointerUp(toPointerSample(e, true))');
    expect(up).toContain('commitPendingStroke()');
    expect(handler('commitPendingStroke')).toContain('editor.commitStroke(index, stroke)');
  });

  it('cancel drains profile-specific committed geometry', () => {
    const cancel = handler('onPointerCancel');
    expect(cancel).toContain('pointer.pointerCancel(toPointerSample(e))');
    expect(cancel).toContain('commitPendingStroke()');
  });
});

describe('layer-aware canvas contract', () => {
  it('refuses to start a stroke in a hidden layer and says why', () => {
    const down = handler('onPointerDown');
    expect(down).toContain('editor.activeLayerHidden');
    expect(down).toContain('showHint(HIDDEN_LAYER_HINT)');
    // The guard runs before the gesture starts.
    expect(down.indexOf('editor.activeLayerHidden')).toBeLessThan(down.indexOf('pointer.pointerDown'));
  });

  it('pins the layer object at pointerdown, not its index', () => {
    // An index can come to mean another layer if the stack is reordered
    // mid-gesture; the object cannot.
    expect(handler('onPointerDown')).toContain('strokeLayer = editor.doc.layers[editor.activeLayer]');
    const commit = handler('commitPendingStroke');
    expect(commit).toContain('editor.doc.layers.indexOf(strokeLayer)');
    // A layer deleted mid-gesture has no index left — the stroke is dropped.
    expect(commit).toMatch(/index\s*(<|===)\s*(0|-1)/);
  });

  it('hides the live preview when the pinned layer is no longer the active one', () => {
    // The stack is split around the ACTIVE layer, so a preview drawn while the
    // selection moved elsewhere would show the stroke on the wrong layer. The
    // commit still lands on the pinned layer either way.
    const draw = handler('draw');
    expect(draw).toContain('strokeLayer === editor.doc.layers[editor.activeLayer]');
  });

  it('caches three composite buffers instead of one canvas per visited frame', () => {
    expect(source).not.toContain('WeakMap<Frame');
    for (const buffer of ['belowEl', 'activeEl', 'aboveEl']) {
      expect(source).toContain(buffer);
    }
  });

  it('rebuilds the buffers from the reactive effect, not from a content digest', () => {
    // A digest over stroke counts misses a paste that swaps cells of equal
    // length; the effect already tracks every document dependency, so it is
    // what marks the stack dirty.
    expect(source).not.toContain('function stackKey');
    expect(source).toContain('stackDirty = true');
    const draw = handler('draw');
    expect(draw).toContain('stackDirty');
    expect(draw).toContain('rebuildStack');
    // Pointer moves repaint without rebuilding: only the effect sets the flag.
    expect(handler('onPointerMove')).not.toContain('stackDirty');
  });

  it('onion-skin composites only the layers the state names for the ghost', () => {
    // Neighbour model: the active layer alone, so a static background is not
    // painted twice. Tonio's history: every selected layer, flattened.
    const onion = source.match(/function onionCell\([^]*?\n  }/)?.[0] ?? '';
    expect(onion).toContain('editor.onionHistoryLayerIndices');
    expect(source).toContain('ONION_CACHE_LIMIT');
  });

  it('keys the onion cache by layer and cell identity, not by index and count', () => {
    // Index + stroke count collide after a reorder, a paste, or a document
    // swap — the cache would hand back another layer's drawing.
    const onion = source.match(/function onionCell\([^]*?\n  }/)?.[0] ?? '';
    expect(onion).toContain('nodeId(layer)');
    expect(onion).toContain('nodeId(cell)');
  });

  it('the pipette honors the configured source and Alt', () => {
    const pick = handler('pickColor');
    expect(pick).toContain('pickSource(editor.pickSource, e.altKey)');
  });
});

describe('transform tools on the canvas', () => {
  it('the hand pans instead of drawing, alongside the middle button and space', () => {
    expect(handler('startNavigation')).toContain("editor.tool === 'drag'");
  });

  it('a tool with a gesture of its own runs between press and release', () => {
    // Distort is one of these now (plugins/distort.ts); the canvas knows only
    // that the tool brought callbacks, not which tool it is.
    expect(handler('onPointerDown')).toContain('editor.beginPluginGesture(');
    expect(handler('onPointerDown')).toContain('.press?.(');
    expect(handler('onPointerMove')).toContain('.move?.(');
    expect(handler('onPointerUp')).toContain('editor.endPluginGesture()');
  });

  it('a live transform takes the drag before the pencil does', () => {
    const down = handler('onPointerDown');
    expect(down.indexOf('editor.transform')).toBeGreaterThan(-1);
    expect(down.indexOf('editor.transform')).toBeLessThan(down.indexOf('pointer.pointerDown'));
  });

  it('a press with the lasso in hand takes the frame again instead of drawing', () => {
    // Apply closes the session but leaves the tool selected; without this the
    // canvas goes dead until the user switches tools and back.
    const down = handler('onPointerDown');
    expect(down).toContain("editor.tool === 'lasso'");
    expect(down).toContain('editor.beginTransform()');
    expect(down.indexOf("editor.tool === 'lasso'")).toBeLessThan(down.indexOf('pointer.pointerDown'));
  });

  it('the pressed zone decides whether the drag moves, turns or scales', () => {
    expect(handler('onPointerDown')).toContain('hitMode(');
    expect(handler('onPointerMove')).toContain('dragTransform(e)');
    const drag = handler('dragTransform');
    expect(drag).toContain('movedBy(');
    expect(drag).toContain('rotatedTo(');
    expect(drag).toContain('scaledBy(');
  });

  it('previews the selection at the width apply will write, so nothing jumps', () => {
    // "Change width with scale" used to land only on apply: the preview kept
    // the old width and the strokes jumped the moment Enter was pressed.
    // It also keeps the pixel tool honest: its cells only stay edge to edge
    // while the width is scaled with the points.
    expect(source).toContain('scaleToolWidth(tool, scale)');
    expect(handler('stackCell')).toContain('widthWithScale');
    // Preview and apply share one quantizer, or the strokes snap on Enter.
    expect(handler('stackCell')).toContain('quantizeStrokePoints(');
    expect(source).toContain('renderStrokesLayer(cells[0], previewTools');
  });

  it('draws the selection moved, not doubled: the stack rasterizes it transformed', () => {
    // Otherwise the originals stay under the preview and every drag smears.
    expect(handler('stackCell')).toContain('editor.transform');
    expect(handler('stackCell')).toContain('editor.transformPoint(');
    expect(handler('rebuildStack')).toContain('stackCell(');
  });

  it('shows the polygon, the frame and its handles as an overlay over the canvas', () => {
    expect(source).toContain('class="overlay"');
    // Purely visual: every gesture is read off the canvas itself, so touch
    // and pointer capture keep working.
    expect(source).toContain('pointer-events: none');
  });
});

describe('the right button draws with the fill colour', () => {
  it('never lets the browser menu open over the canvas', () => {
    expect(source).toContain('oncontextmenu={(e) => e.preventDefault()}');
  });

  it('freezes a swapped descriptor for a stroke started with another button', () => {
    expect(source).toContain('swapStrokeColours(');
    expect(handler('onPointerDown')).toContain('strokeButton = e.button');
  });
});

describe('mouse mode in the Tonio profile', () => {
  it('takes the event itself instead of unpacking coalesced samples', () => {
    // Reference `oldPen`: the checkbox that makes Multator's pen oldschool
    // makes Tonio read one point per event.
    expect(handler('toPointerSample')).toContain('!editor.settings.mouseMode');
  });
});

describe('the pipette over emptiness', () => {
  it('reads nothing from a pixel that is not fully opaque', () => {
    // Reference: alpha ≠ 255 is "no colour here", including the antialiased
    // rim of a stroke — not the background colour.
    expect(handler('pickColor')).toContain('a !== 255');
    expect(source).toContain('function pickColor(e: PointerEvent): string | null');
  });

  it('arms the eraser and leaves both colours alone', () => {
    const down = handler('onPointerDown');
    expect(down).toContain('picked === null');
    expect(down).not.toContain('editor.brushColor = picked');
  });

  it('gives the previous drawing tool back after a left-button pick', () => {
    expect(handler('onPointerDown')).toContain('editor.resetHelpTool()');
  });
});

describe('the cursor over the canvas', () => {
  it('rings in fixed colours, never the pen colour', () => {
    expect(source).not.toContain('style:border-color={cursorColor}');
  });

  it('takes its ring and cross from the shared rule', () => {
    expect(source).toContain('cursorShape(');
  });

  it('is a hand while the hand tool is up, closed while it drags', () => {
    expect(source).toContain("'grabbing'");
    expect(source).toContain("'grab'");
  });

  it('measures the ring by the width the stroke really lands at', () => {
    // A pixel is a pixel: the ring is the slider's own number through the
    // view (fit × zoom), with nothing about the document's size in between.
    expect(source).toContain('(editor.brushSizeLogical * sheetWidth * editor.view.zoom)');
  });

  it('squares the cursor and lays a difference grid under the pixel tool', () => {
    expect(source).toContain('class:square=');
    expect(handler('draw')).toContain("drawPixelGrid(");
    expect(handler('drawPixelGrid')).toContain("'difference'");
  });

  it('takes the grid away while the preview plays', () => {
    expect(handler('draw')).toContain("?.stroke?.grid && !editor.playing");
  });
});

describe('the mega eraser', () => {
  it('previews the swath at the width it will really cut', () => {
    // The smear on screen and the cut on release take the same number the
    // slider shows — one of them scaled and the other not is how the gesture
    // used to swallow more than it promised.
    const preview = source.match(/renderRawPolyline\(\s*megaGesture,[^)]*\)/)?.[0] ?? '';
    expect(preview).toContain('brushWidthDoc(editor.brushSizeLogical)');
    expect(handler('onPointerUp')).toContain('brushWidthDoc(editor.brushSizeLogical) / 2');
  });
});

describe('the wheel zoom', () => {
  it('recentres the view on the cursor instead of pinning the point', () => {
    expect(handler('onWheel')).toContain('zoomCentredOn(');
  });

  it('stays out of the way while the preview runs', () => {
    expect(handler('onWheel')).toContain('editor.playing');
  });

  it('remembers where the cursor was, so the buttons and keys zoom there', () => {
    expect(handler('onPointerMove')).toContain('editor.lastScalePivot = ');
  });
});

describe('onion position in the layer stack (Toonio parity)', () => {
  it('the ghosts land between the layers below and the active one', () => {
    const draw = source.slice(source.indexOf('blitLayer(belowEl'));
    expect(source).toContain('drawOnion(');
    // The ghosts are blitted after the layers below the active one and before it.
    const below = source.indexOf('blitLayer(belowEl!, ctx)');
    const onion = source.indexOf('drawOnion(ctx', below);
    const active = source.indexOf('blitLayer(activeWithLive, ctx)', below);
    expect(onion).toBeGreaterThan(below);
    expect(active).toBeGreaterThan(onion);
    expect(draw).toBeTruthy();
  });

  it('a ghost flattens every layer the selection covers', () => {
    expect(source).toContain('editor.onionHistoryLayerIndices');
  });
});

describe('the ghosts repaint when the selection changes', () => {
  // The ghost is built from every selected layer, so the redraw effect has to
  // subscribe to that list — and to the cells of those layers, not just the
  // active one. Without it a Ctrl+click showed nothing until the active layer
  // moved and something else invalidated the stack.
  function redrawEffect(): string {
    const match = source.match(/\$effect\(\(\) => \{[^]*?stackDirty = true;[^]*?\n  \}\);/);
    if (!match) throw new Error('missing the stack effect');
    return match[0];
  }

  it('subscribes to the layers the ghosts are drawn from', () => {
    expect(redrawEffect()).toContain('editor.onionHistoryLayerIndices');
  });

  it('subscribes to those layers cells, not only the active one', () => {
    const effect = redrawEffect();
    const ghostLoop = effect.slice(effect.indexOf('editor.onionSkinLayers'));
    expect(ghostLoop).not.toContain('activeLayer?.frames');
  });
});

describe('the sheet lies on a worktable', () => {
  it('gives the canvas element the whole workspace, with the sheet drawn on it', () => {
    expect(source).toContain('style:width="{stage.width}px"');
    expect(source).toContain('style:height="{stage.height}px"');
    expect(source).toContain('sheetWidth');
  });

  it('paints the paper where the view puts it and keeps the drawing on it', () => {
    const draw = handler('draw');
    // The table shows through around the sheet instead of a full-bleed fill.
    expect(draw).toContain('clearRect(0, 0, pxWidth, pxHeight)');
    expect(draw).toContain('fillStyle = BACKGROUND_COLOR');
    expect(draw).toContain('ctx.clip()');
  });

  it('reads pointer positions against the sheet, not the workspace', () => {
    expect(handler('toDocUnits')).toContain('sheetWidth');
  });

  it('keeps the sheet on the table when the workspace changes size', () => {
    expect(source).toContain('editor.stage = stage');
    expect(source).toContain('clampPan(');
  });
});

describe('what the canvas asks whom', () => {
  it('takes its rasterisation from the preset, never from the brush in hand', () => {
    // A document has one bitmap: two brushes of two canvases cannot each have
    // their own. The reference that rasterises at document scale is a preset.
    expect(source).toContain("editor.ux.canvasDensity === 'document'");
    expect(source).not.toContain("editor.defaultBrush === 'toonio'");
  });
});
