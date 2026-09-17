# Drawing compatibility rendering

Both saved dialects use fixed-point document coordinates (`1 logical px = 8 units`) and are dispatched only from the saved tool descriptor.

- `multator` keeps toonop's original midpoint emitter and dot-as-filled-circle behavior.
- `toonio` ports `Tool.Curve` from the studied Tonio source: it consumes the duplicated endpoint sentinel, emits midpoint quadratics without re-running input preparation, and applies the `+0.01` coincident-point workaround.

Golden command tests are the geometry authority. Representative DPR=1 software-raster signatures guard broad pixel changes. Unlike original Tonio, toonop deliberately folds device pixel ratio into the Canvas transform; on DPR>1 this produces a sharper raster while logical geometry, widths, compositing, and path commands remain unchanged.

## Layers

A document frame is the composite of its visible layers, bottom-up (`schema_version: 3`, `layers[] → frames[] → strokes[]`, up to 20 layers, every layer the same length). Each layer rasterizes into its own transparent buffer before it lands on the target, so `eraser` and `contour-eraser` cut the alpha of their own layer only — the layer below shows through instead of the background. That is the single eraser path now: the former opaque "eraser paints the background color" branch is gone, so thumbnails, player, GIF and the WebP preview all erase the same way the canvas does. A `hidden` layer is skipped everywhere it could appear (canvas, timeline thumbnails, player, GIF, preview); a single-layer frame without erasers still draws straight into the target, pixel-identical to the composited path.

The shared fixture corpus is the parity contract between the TS and Rust validators, and both agree on every fixture. One known divergence is still open: a number spelled `1e2` parses to the integer `100` in JavaScript, so the editor's validator cannot tell it from `100`, while serde keeps the float and the server rejects the body. The root cause is on the server — RFC 8785 canonicalizes a number from its value, so `1e2` must serialize as `100`, and the Rust canonicalizer printing `100.0` is what makes the stricter typed gate necessary. It predates layers, applies to v1 and v2 alike, and is fixed on its own. Meanwhile the editor's own serializer never emits that spelling, so nothing it produces is affected.

The format carries no layer name — the panel numbers rows by position, top-down. Older documents load through `v1 → v2 → v3`: a v2 document's frames become the cells of one visible layer, strokes and `tool_id`s untouched, and it renders exactly as it did before the migration.

Onion skin shows the neighbor cells of the **active layer** only, so a static background is not drawn twice. The `multator` active-frame alpha (0.8) applies to the whole composited frame, not per layer.

## Preset UX profiles

Beyond the stroke dialect, each toolbar preset owns a UX profile (`src/lib/ui/ux-profile.ts`). `multator` reproduces the reference editor end to end: black/red quick palette with the full picker and pipette behind `M`, white = eraser, adaptive `+`/`-` steps (1/5/10, cap 300), onion skin of the two previous frames only, active frame composited at 0.8 (its `containerSprite.alpha`), delete selects the previous frame, `Ctrl`+add inserts before, playback starts from frame 1 and returns to the edited frame, 5 fps default (30 fps stage ÷ 6). `toonop` (also used by the Toonio preset) keeps the editor's own behavior. The layers panel is a preset feature (`layers`): on in Toonop and Toonio, off in Multator; switching to a preset without the panel makes a hidden active layer visible again, since there would be no way back. Out of scope: the server save form and the contest `frameLimit`/`disableCopy` flags.

## Oldschool pen ("old" easter egg)

Typing `o`, `l`, `d` toggles the reference's hidden oldschool pen (Main.hx `lastThreeKeys` → DrawField.hx `onOldEndDraw`). The gesture is captured like a Multator line, but the commit runs Lang 5/5 px and traces a closed contour around the polyline at radius `trunc(size/2)` with a random wobble on gentle bends (`src/lib/tools/oldschool.ts`), stored under the v2 tool kinds `contour` (color) / `contour-eraser` (reference `action=4, size=0`). The renderer fills it as a closed midpoint multicurve (`emitMultatorClosedPath`, reference `multicurve(..., true)`); the eraser variant punches alpha. Tonio strokes ignore the flag. One deliberate fix over the port: a click without movement gives the 8-point circle the reference intended (its dot flag was never set).
