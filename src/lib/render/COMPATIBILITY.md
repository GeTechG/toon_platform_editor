# Drawing compatibility rendering

Both saved dialects use fixed-point document coordinates (`1 logical px = 8 units`) and are dispatched only from the saved tool descriptor.

- `multator` keeps toonop's original midpoint emitter and dot-as-filled-circle behavior.
- `toonio` ports `Tool.Curve` from the studied Tonio source: it consumes the duplicated endpoint sentinel, emits midpoint quadratics without re-running input preparation, and applies the `+0.01` coincident-point workaround.

Golden command tests are the geometry authority. Representative DPR=1 software-raster signatures guard broad pixel changes. Unlike original Tonio, toonop deliberately folds device pixel ratio into the Canvas transform; on DPR>1 this produces a sharper raster while logical geometry, widths, compositing, and path commands remain unchanged.
