import { describe, expect, it } from 'bun:test';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
/** The frame itself is put together here now; the canvas only shows it. */
const compose = await Bun.file(new URL('../render/frame-compose.ts', import.meta.url)).text();

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
    // The state's one guard refuses and sets the hint (owner-twelfth-canvas).
    expect(down).toContain('editor.mayEdit()');
    // The guard runs before the gesture starts.
    expect(down.indexOf('editor.mayEdit()')).toBeLessThan(down.indexOf('pointer.pointerDown'));
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
    expect(handler('liveLine')).toContain('strokeLayer !== editor.doc.layers[editor.activeLayer]');
  });

  it('caches three composite buffers instead of one canvas per visited frame', () => {
    expect(compose).not.toContain('WeakMap<Frame');
    for (const buffer of ['#below', '#active', '#above']) {
      expect(compose).toContain(buffer);
    }
  });

  it('rebuilds the buffers from the reactive effect, not from a content digest', () => {
    // A digest over stroke counts misses a paste that swaps cells of equal
    // length; the effect already tracks every document dependency, so it is
    // what tells the composer the frame went stale.
    expect(source).not.toContain('function stackKey');
    expect(source).toContain('composer.invalidate()');
    expect(compose).toContain('#stale');
    // Pointer moves repaint without rebuilding: only the effect invalidates.
    expect(handler('onPointerMove')).not.toContain('composer.invalidate');
  });

  it('onion-skin composites only the layers the state names for the ghost', () => {
    // Neighbour model: the active layer alone, so a static background is not
    // painted twice. Tonio's history: every selected layer, flattened.
    expect(handler('draw')).toContain('layers: editor.onionHistoryLayerIndices');
    expect(compose).toContain('GHOST_BUFFERS');
  });

  it('redraws a ghost into a buffer it already has, never into a new canvas', () => {
    // The key carries the pan, so a hand moving the sheet misses the cache on
    // every frame; a miss that made a canvas was a full-stage backing store
    // per ghost per frame, handed straight to the collector.
    expect(compose).toContain('this.#ghosts.take(key)');
    expect(compose).toContain('new BufferRing(');
  });

  it('keys the onion cache by layer and cell identity, not by index and count', () => {
    // Index + stroke count collide after a reorder, a paste, or a document
    // swap — the cache would hand back another layer's drawing.
    expect(compose).toContain('nodeId(layer)');
    expect(compose).toContain('nodeId(cell)');
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
    expect(handler('onPointerDown')).toContain('spec.press(');
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
    expect(handler('onPointerMove')).toContain('dragTransform(e, rect)');
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
    // The stack rasterizes with that table, so the preview is what lands.
    expect(handler('draw')).toContain('tools: previewTools');
  });

  it('draws the selection moved, not doubled: the stack rasterizes it transformed', () => {
    // Otherwise the originals stay under the preview and every drag smears.
    expect(handler('stackCell')).toContain('editor.transform');
    expect(handler('stackCell')).toContain('editor.transformPoint(');
    // The composer asks for the cell as it should be drawn, not as it is stored.
    expect(handler('draw')).toContain('cellAt: stackCell');
    expect(compose).toContain('scene.cellAt');
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
    expect(source).toContain('function pickColor(e: { clientX: number; clientY: number; altKey: boolean }): string | null');
  });

  it('arms the eraser and leaves both colours alone', () => {
    // The tool and the held finger share the take (canvas-colour-gesture).
    const down = handler('takeColour');
    expect(handler('onPointerDown')).toContain('takeColour(e, toFill)');
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
    expect(source).toContain('diameterOf(editor.brushSizeLogical)');
    expect(source).toContain('(size * sheetWidth * editor.view.zoom)');
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

describe('the live stroke is added to, not redrawn', () => {
  // Redrawing the whole line every frame costs the whole line every frame:
  // the longer it is drawn, the further it trails the hand.
  it('keeps the settled part of the line on the buffer', () => {
    expect(compose).toContain('renderLivePart(');
    expect(compose).toContain('#livePainted');
    // The end still moving goes on the target, which is repainted every frame
    // anyway — so the buffer holds nothing stale.
    expect(compose).toContain('#paintLiveTail');
  });

  it('reseeds the buffer when anything under the line changes', () => {
    const seed = compose.match(/const seed = [^;]*\n[^;]*;/)?.[0] ?? '';
    expect(seed).toContain('this.#serial');
    expect(seed).toContain('viewport.scale');
    expect(seed).toContain('viewport.panX');
    expect(compose).toContain('this.#serial += 1');
  });

  it('draws an eraser and a feather whole: their mark depends on the whole figure', () => {
    const live = handler('liveLine');
    expect(live).toContain("session.descriptor.kind === 'pencil'");
    expect(live).toContain("geometry === 'line' || geometry === 'smooth'");
    // A line that cannot be added to hands over the way to paint it instead.
    expect(live).toContain('paint: (target)');
  });
});

describe('the mega eraser', () => {
  it('previews the swath at the width it will really cut', () => {
    // The smear on screen and the cut on release take the same number the
    // slider shows — one of them scaled and the other not is how the gesture
    // used to swallow more than it promised.
    const live = handler('liveLine');
    expect(live).toContain('megaGesture');
    expect(live).toContain('brushWidthDoc(editor.brushSizeLogical)');
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
    // Asserted for real against a recording target in frame-compose.test.ts;
    // here only that the canvas still asks for them.
    expect(handler('draw')).toContain('ghosts: editor.showOnionSkin');
    const below = compose.indexOf('blitLayer(this.#below!.image, target)');
    const ghosts = compose.indexOf('this.#drawGhosts(target', below);
    const active = compose.indexOf('blitLayer(active.image, target)', below);
    expect(ghosts).toBeGreaterThan(below);
    expect(active).toBeGreaterThan(ghosts);
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
    const match = source.match(/\$effect\(\(\) => \{[^]*?composer\.invalidate\(\);[^]*?\n  \}\);/);
    if (!match) throw new Error('missing the stack effect');
    return match[0];
  }

  it('subscribes to the layers the ghosts are drawn from', () => {
    expect(redrawEffect()).toContain('editor.onionHistoryLayerIndices');
  });

  it('subscribes to the document, which every write to it replaces', () => {
    expect(redrawEffect()).toContain('void editor.doc;');
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
    expect(draw).toContain('ctx.clip()');
    // The paper is a flat fill where the sheet lands — no shadow to buffer.
    expect(draw).toContain('fillStyle = BACKGROUND_COLOR');
    expect(draw).toContain('fillRect(sheet.x, sheet.y, sheet.w, sheet.h)');
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

describe('the frame pays only for what changed', () => {
  const draw = handler('draw');

  // `shadowBlur` is one of the most expensive things a 2D context does; the
  // paper had one on every draw, then behind a buffer. Since the studio went
  // flat (2026-09-23) the paper has no shadow at all, and no buffer for it.
  it('fills the paper flat, with no blur in the frame', () => {
    expect(draw).not.toContain('shadowBlur');
    expect(source).not.toContain('function paperBuffer');
  });

  // Every coalesced sample of a pointermove called `toDocUnits`, and every
  // call read the canvas rect again: one layout query per sample of a stroke,
  // where one per event is all the geometry the event has.
  it('reads the canvas rect once per pointer event, not once per sample', () => {
    const toDocUnits = handler('toDocUnits');
    expect(toDocUnits).not.toContain('getBoundingClientRect');
    expect(source).toContain('function canvasRect');
  });
});

// Pan and pinch rebuilt the whole frame on every animation frame: the view is
// one of the composer's inputs, and the ghosts are cached by a key that
// includes the pan. The hand moves the picture, not what is in it.
describe('a navigation gesture moves the picture instead of rebuilding it', () => {
  it('the gesture takes a shot of the last composed frame when it starts', () => {
    expect(handler('startNavigation')).toContain('takeNavShot()');
  });

  it('while the hand moves, draw shows the shot through the reprojection', () => {
    const draw = handler('draw');
    expect(draw).toContain('reprojection(');
    expect(draw.indexOf('reprojection(')).toBeLessThan(draw.indexOf('composer.compose('));
  });

  it('letting go drops the shot and composes once at full density', () => {
    expect(handler('endNavigation')).toContain('dropNavShot()');
    expect(handler('dropNavShot')).toContain('navShot = null');
    expect(source).not.toContain('renderDensity(window.devicePixelRatio || 1, navigating())');
  });
});

// The brush ring and the pipette swatch followed the pointer by `left`/`top`,
// a layout on every pointermove — at a 120 Hz touch rate, while drawing.
describe('the cursor follows the pointer on the compositor', () => {
  it('moves by transform, not by left/top', () => {
    expect(source).not.toContain('style:left="{cursorX}px"');
    expect(source).not.toContain('style:top="{cursorY}px"');
    expect(source).toContain('style:transform="translate({cursorX}px, {cursorY}px)');
  });
});

// Tenth audit: what the canvas still did wrong with a pen, a wheel during the
// preview, a readback per pipette move and a window dragged to another screen.
describe('the canvas after the tenth audit', () => {
  it('the pipette reads back from a context made for reading', () => {
    // Chrome warned on every hover: each getImageData pulled the scratch off
    // the GPU.
    expect(handler('pickColor')).toContain('willReadFrequently: true');
  });

  it('takes the wheel even while the preview plays', () => {
    // Ctrl+wheel zoomed the whole page and a sideways swipe went back in the
    // history — with the drawing — while the preview ran.
    const wheel = handler('onWheel');
    expect(wheel.indexOf('e.preventDefault()')).toBeLessThan(wheel.indexOf('editor.playing'));
  });

  it('ends a pen stroke whose release it never heard, the way it does for a mouse', () => {
    // A pen hovers: a lost pointerup left the stroke following the hover.
    const move = handler('onPointerMove');
    expect(move).toContain("e.pointerType !== 'touch' && e.buttons === 0");
  });

  it("the pen's eraser end erases, and flipping it back gives the tool back", () => {
    // Button 5 is the eraser end; it read as "not the left button" and drew
    // with the fill colour.
    const flip = handler('followPenEnd');
    expect(flip).toContain('e.button === 5');
    expect(flip).toContain("editor.selectTool('eraser')");
    expect(handler('onPointerDown')).toContain('followPenEnd(e)');
  });

  it('redraws when the window moves to a screen of another density', () => {
    // Nothing else changes size there, so nothing asked for a frame and the
    // lines stayed at the old screen's density — blurry or oversized.
    expect(source).toContain('(resolution: ${window.devicePixelRatio}dppx)');
  });
});

describe('the hand under a finger', () => {
  it('one finger with the hand pans instead of drawing a line', () => {
    // The touch branch returned before the hand was asked: on a phone the
    // hand drew with the pencil's brush.
    const nav = handler('startNavigation');
    expect(nav).not.toContain('return touches.size > 1;');
    expect(nav.indexOf("editor.tool === 'drag'")).toBeGreaterThan(nav.indexOf("e.pointerType === 'touch'"));
  });

  it('a second finger turns the hand\'s pan into a pinch, not both at once', () => {
    const nav = handler('startNavigation');
    const pinch = nav.slice(nav.indexOf('touches.size === 2'));
    expect(pinch.slice(0, pinch.indexOf('return true'))).toContain('panning = null');
  });
});

describe('palm rejection once a pen has touched the sheet', () => {
  it('a pen down marks the session as pen-seen, for as long as the editor lives', () => {
    expect(handler('onPointerDown')).toContain('editor.penSeen = true');
  });

  it('after the pen, one finger pans the sheet instead of drawing', () => {
    const nav = handler('startNavigation');
    expect(nav).toContain("editor.tool === 'drag' || (e.pointerType === 'touch' && editor.penSeen)");
  });

  it('a palm that lands while the pen is busy neither pans nor pinches', () => {
    const nav = handler('startNavigation');
    const touch = nav.slice(nav.indexOf("e.pointerType === 'touch'"));
    expect(touch.indexOf('penBusy()')).toBeGreaterThan(-1);
    expect(touch.indexOf('penBusy()')).toBeLessThan(touch.indexOf('touches.set('));
  });

  it('a pen panning as the hand is busy too: the palm does not pan under it', () => {
    expect(handler('penBusy')).toContain('panning !== null && !touches.has(panning.pointerId)');
  });

  it('a pen landing on a finger stroke drops that stroke before drawing', () => {
    const down = handler('onPointerDown');
    const pen = down.slice(down.indexOf("e.pointerType === 'pen'"));
    // Before the one-gesture guard, or the finger's stroke would block the pen.
    expect(pen.indexOf('pointer.discard()')).toBeGreaterThan(-1);
    expect(pen.indexOf('pointer.discard()')).toBeLessThan(pen.indexOf('pointer.session) {'));
    expect(pen).toContain('touches.has(pointer.session.pointerId)');
  });
});

describe('the finger left after a pinch', () => {
  it('keeps panning with the hand or after the pen, without lifting', () => {
    const end = handler('endNavigation');
    expect(end).toMatch(/touches\.size === 1 && \(editor\.tool === 'drag' \|\| editor\.penSeen\)/);
    expect(end).toContain('panning = { pointerId');
  });
});
