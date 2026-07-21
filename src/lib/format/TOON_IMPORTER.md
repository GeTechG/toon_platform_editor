# Future `.toon` importer seam

The importer must decode Tonio's tool table and prepared line arrays directly into the v2 document model. It must not call `tonioSmooth`, `tonioPrepare`, pointer collection, or coordinate quantization: imported `p` arrays are already prepared geometry.

Mapping for the supported first importer slice:

| Tonio value | v2 value |
| --- | --- |
| pencil tool `{ w, c }` | `{ kind: 'pencil', dialect: 'toonio', width: w * 8, color: normalizedRgb }` |
| eraser tool `{ w }` | `{ kind: 'eraser', dialect: 'toonio', width: w * 8 }` |
| line `{ d, p }` | `{ tool_id: intern(mappedTools[d]), points: p.map(value => value * 8) }` |

Tool descriptors are structurally interned in first-use order. Each imported line keeps its prepared endpoint representation and references the mapped descriptor. Layers, shared cels/exposures, holds, and unsupported Tonio tools require a later format version; they wrap or reference the same v2 stroke/tool core rather than changing its renderer contract.
