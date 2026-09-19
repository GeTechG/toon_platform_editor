import { describe, expect, it } from 'bun:test';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name} handler`);
  return match[0];
}

describe('current Multator pointer lifecycle contract', () => {
  it('starts only a primary, non-playing, single active gesture and captures it', () => {
    const down = handler('onPointerDown');
    expect(down).toContain('editor.playing || !e.isPrimary || pointer.session');
    expect(down).toContain('setPointerCapture(e.pointerId)');
    expect(down).toContain('pointer.pointerDown(toPointerSample(e, true))');
    expect(source).toContain("(pointer.session?.profile ?? editor.drawingProfile) === 'toonio'");
    expect(source).toContain('coordinateScale: brushCanvasScale');
    expect(source).toContain('canvasCoordinateScale(');
  });

  it('takes exactly one point from each pointermove without unpacking coalesced events', () => {
    const move = handler('onPointerMove');
    expect(move).toContain('pointer.pointerMove(toPointerSample(e, true))');
    expect(source).toContain("(pointer.session?.profile ?? editor.drawingProfile) === 'toonio'");
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

  it('onion-skin composites neighbor cells of the active layer only', () => {
    const onion = source.match(/function onionCell\([^]*?\n  }/)?.[0] ?? '';
    expect(onion).toContain('editor.activeLayer');
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

  it('the distort brush shakes the frame between press and release', () => {
    expect(handler('onPointerDown')).toContain('editor.beginDistort(');
    expect(handler('onPointerMove')).toContain('editor.distortStep(');
    expect(handler('onPointerUp')).toContain('editor.endDistort()');
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
    // After the reference-canvas normalisation a Tonio width of 5 draws
    // thinner than 5 logical px, and the ring has to follow it.
    expect(source).toContain('brushLogicalOnCanvas');
  });

  it('squares the cursor and lays a difference grid under the pixel tool', () => {
    expect(source).toContain('class:square=');
    expect(handler('draw')).toContain("drawPixelGrid(");
    expect(handler('drawPixelGrid')).toContain("'difference'");
  });

  it('takes the grid away while the preview plays', () => {
    expect(handler('draw')).toContain("editor.tool === 'pixel' && !editor.playing");
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
