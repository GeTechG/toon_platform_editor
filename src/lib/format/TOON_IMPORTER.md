# `.toon` importer

`src/lib/format/toon-decode.ts` decodes Tonio's tool table and prepared line arrays directly into the document model. It must not call `tonioSmooth`, `tonioPrepare`, pointer collection, or coordinate quantization: imported `p` arrays are already prepared geometry.

Mapping for the supported first importer slice:

| Tonio value | v2 value |
| --- | --- |
| pencil tool `{ w, c }` | `{ kind: 'pencil', dialect: 'toonio', width: w * 8, color: normalizedRgb }` |
| eraser tool `{ w }` | `{ kind: 'eraser', dialect: 'toonio', width: w * 8 }` |
| line `{ d, p }` | `{ tool_id: intern(mappedTools[d]), points: p.map(value => value * 8) }` |

Since schema v4 the table also holds `feather` (`{ w, c, f }` → `{ kind: 'feather', dialect: 'toonio', width: w * 8, color, fill }`) and `pixel` (`{ w, c }` → `{ kind: 'pixel', … }`); imported pixel lines keep the reference's sparse cells, because the renderer fills the gaps with the same Bresenham walk the reference applies at draw time. Mega-eraser strokes never appear in a file — the reference does not store them.

Tool descriptors are structurally interned in first-use order. Each imported line keeps its prepared endpoint representation and references the mapped descriptor. Layers, shared cels/exposures, holds, and unsupported Tonio tools require a later format version; they wrap or reference the same v2 stroke/tool core rather than changing its renderer contract.


## What the decoder does (v5 and legacy 1–4)

The stream is flat Int16 words whose meaning is positional (`toon.js` `Toon.Gen` / `Toon.Degenerate`): layer count, frame count, frame rate, then — for a versioned file — the signature `999` and the version. From v3 the original's title follows, from v5 a tool table, then per layer a visibility flag, a name (v2+) and its frames; a frame is either the clone flag `1` (v4+) or a line count and its lines. A line is a tool index (v5) or an inline tool with both colors (pre-v5), then a point count and the points — plain pairs in v5, sign/magnitude quads before it. Counts are read as unsigned (the reference's `65536 + n` wrap).

Decisions worth knowing:

- **The canvas is not in the file.** Tonio's is fixed 1280×720, so an imported document keeps that size (×8 fixed point) rather than being squeezed into the editor's 600×300 — rescaling would change the drawing.
- **Layer order is reversed.** The reference draws `layers[0]` last, so its first layer is the topmost; ours renders bottom-up.
- **Clone frames become copies.** The reference shares one frame object between a hold and its predecessor; our cells are independent, so editing one may not change the other.
- **Nothing is substituted.** A mega-eraser or unknown tool in the table, a coordinate that will not fit int16 after ×8, a truncated stream, or a tail left over after the drawing all reject the file with a message. Version 1 files carry no signature at all, so "the stream ends exactly where the drawing does" is what tells a `.toon` from any other blob.
