/**
 * Document migrations: v1 → v2 → v3, and nothing else. Kept apart from
 * ./validate so a consumer that only has to *read* an old document — the
 * read-only player on the public share page — does not drag ajv and the three
 * JSON schemas into its bundle.
 */

import type { ToonDocumentV1, ToonDocumentV2, ToonDocumentV3 } from './types';

type AnyDocument = ToonDocumentV1 | ToonDocumentV2 | ToonDocumentV3;

/** Lifts any supported version to v3. Structure only — no validation. */
export function upgradeDocument(doc: AnyDocument): ToonDocumentV3 {
  if (doc.schema_version === 1) {
    return migrateV2ToV3(migrateV1ToV2(doc));
  }
  return doc.schema_version === 2 ? migrateV2ToV3(doc) : doc;
}

/**
 * Lifts a flat v2 document into v3: its frames become the cells of the single,
 * visible layer. Strokes, tool ids and the tool table are carried over as they
 * are — the migration is a reshape, not a reinterpretation.
 */
export function migrateV2ToV3(doc: ToonDocumentV2): ToonDocumentV3 {
  return {
    schema_version: 3,
    width: doc.width,
    height: doc.height,
    frame_rate: doc.frame_rate,
    tools: structuredClone(doc.tools),
    layers: [{ hidden: false, frames: structuredClone(doc.frames) }],
  };
}

/**
 * Pre-flag documents encoded the eraser as a white (#ffffff) stroke; white was
 * unreachable as a paint color then, so any such stroke was an erase. Convert
 * them to the erase flag in place so old drafts keep erasing.
 */
export function migrateLegacyEraser(doc: ToonDocumentV1): ToonDocumentV1 {
  for (const frame of doc.frames) {
    for (const stroke of frame.strokes) {
      if (!stroke.erase && stroke.color === '#ffffff') {
        stroke.erase = true;
      }
    }
  }
  return doc;
}

/** Deterministically upgrades inline v1 stroke attributes to v2 tool references. */
export function migrateV1ToV2(doc: ToonDocumentV1): ToonDocumentV2 {
  const tools: ToonDocumentV2['tools'] = [];
  const toolIds = new Map<string, number>();
  const frames = doc.frames.map((frame) => ({
    strokes: frame.strokes.map((stroke) => {
      const erase = stroke.erase === true || stroke.color === '#ffffff';
      const descriptor = erase
        ? { kind: 'eraser' as const, dialect: 'multator' as const, width: stroke.width }
        : {
            kind: 'pencil' as const,
            dialect: 'multator' as const,
            width: stroke.width,
            color: stroke.color,
          };
      const key = descriptor.kind === 'eraser'
        ? `eraser\u0000${descriptor.dialect}\u0000${descriptor.width}`
        : `pencil\u0000${descriptor.dialect}\u0000${descriptor.width}\u0000${descriptor.color}`;
      let toolId = toolIds.get(key);
      if (toolId === undefined) {
        toolId = tools.length;
        tools.push(descriptor);
        toolIds.set(key, toolId);
      }
      return { points: stroke.points.slice(), tool_id: toolId };
    }),
  }));
  return {
    schema_version: 2,
    width: doc.width,
    height: doc.height,
    frame_rate: doc.frame_rate,
    tools,
    frames,
  };
}
