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
    expect(source).toContain('tonioCoordinateScale: TONIO_CANVAS_WIDTH / (editor.doc.width / FIXED_POINT_SCALE)');
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
    expect(pick).toContain('BACKGROUND_COLOR');
  });
});
