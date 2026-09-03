# Drawing compatibility rendering

Both saved dialects use fixed-point document coordinates (`1 logical px = 8 units`) and are dispatched only from the saved tool descriptor.

- `multator` keeps toonop's original midpoint emitter and dot-as-filled-circle behavior.
- `toonio` ports `Tool.Curve` from the studied Tonio source: it consumes the duplicated endpoint sentinel, emits midpoint quadratics without re-running input preparation, and applies the `+0.01` coincident-point workaround.

Golden command tests are the geometry authority. Representative DPR=1 software-raster signatures guard broad pixel changes. Unlike original Tonio, toonop deliberately folds device pixel ratio into the Canvas transform; on DPR>1 this produces a sharper raster while logical geometry, widths, compositing, and path commands remain unchanged.

## Preset UX profiles

Beyond the stroke dialect, each toolbar preset owns a UX profile (`src/lib/ui/ux-profile.ts`). `multator` reproduces the reference editor end to end: black/red quick palette with the full picker and pipette behind `M`, white = eraser, adaptive `+`/`-` steps (1/5/10, cap 300), onion skin of the two previous frames only, active frame composited at 0.8 (its `containerSprite.alpha`), delete selects the previous frame, `Ctrl`+add inserts before, playback starts from frame 1 and returns to the edited frame, 5 fps default (30 fps stage ÷ 6). `toonop` (also used by the Toonio preset) keeps the editor's own behavior. Out of scope: the "old" easter-egg pen (variable-width contour, needs a new tool kind), the server save form and the contest `frameLimit`/`disableCopy` flags.
