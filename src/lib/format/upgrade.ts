/**
 * Document migrations: v1 → v2 → v3, and nothing else. Kept apart from
 * ./validate so a consumer that only has to *read* an old document — the
 * read-only player on the public share page — does not drag ajv and the three
 * JSON schemas into its bundle.
 */

import type {
  ToonDocumentV1,
  ToonDocumentV2,
  ToonDocumentV3,
  ToonDocumentV4,
  ToonDocumentV5,
} from './types';

type AnyDocument =
  | ToonDocumentV1
  | ToonDocumentV2
  | ToonDocumentV3
  | ToonDocumentV4
  | ToonDocumentV5;

/** Lifts any supported version to v5. Structure only — no validation. */
export function upgradeDocument(doc: AnyDocument): ToonDocumentV5 {
  if (doc.schema_version === 1) {
    doc = migrateV1ToV2(doc);
  }
  if (doc.schema_version === 2) {
    doc = migrateV2ToV3(doc);
  }
  if (doc.schema_version === 3) {
    doc = migrateV3ToV4(doc);
  }
  return doc.schema_version === 4 ? migrateV4ToV5(doc) : doc;
}

/**
 * v5 only adds the optional layer `name`, so a v4 document is already a valid
 * v5 one — the migration is the version bump, nothing gains a name.
 */
export function migrateV4ToV5(doc: ToonDocumentV4): ToonDocumentV5 {
  return { ...doc, schema_version: 5 };
}

/**
 * v4 only widens the tool table with the feather and pixel kinds, so a v3
 * document is already a valid v4 one — the migration is the version bump.
 */
export function migrateV3ToV4(doc: ToonDocumentV3): ToonDocumentV4 {
  return { ...doc, schema_version: 4 };
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
