/**
 * Document validation: JSON Schema (ajv, draft 2020-12) plus semantic
 * checks the schema cannot express. The schema is the single source of
 * structural validation, shared with the future Rust implementation
 * (phase 2).
 */

import Ajv2020 from 'ajv/dist/2020';
import schemaV1 from './schema/toon-v1.schema.json';
import schemaV2 from './schema/toon-v2.schema.json';
import schemaV3 from './schema/toon-v3.schema.json';
import { MAX_SUPPORTED_SCHEMA_VERSION, MAX_TOTAL_POINTS } from './constants';
import type { ToonDocumentV1, ToonDocumentV2, ToonDocumentV3 } from './types';

export type ValidationCategory = 'unsupported-version' | 'schema' | 'semantic';

export interface ValidationIssue {
  category: ValidationCategory;
  /** JSON Pointer to the invalid value ('' — the whole document). */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const ajv = new Ajv2020({ allErrors: true });
const validateSchemaV1 = ajv.compile(schemaV1);
const validateSchemaV2 = ajv.compile(schemaV2);
const validateSchemaV3 = ajv.compile(schemaV3);
const SCHEMAS = [validateSchemaV1, validateSchemaV2, validateSchemaV3];

/** Document load error; carries the list of validation issues. */
export class FormatError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path || '<document>'}: ${issue.message}`).join('; '));
    this.name = 'FormatError';
    this.issues = issues;
  }
}

export function validateDocument(data: unknown): ValidationResult {
  // 1. Schema version — before interpreting any content.
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return failure('schema', '', 'document must be a JSON object');
  }
  const version = (data as Record<string, unknown>).schema_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return failure('schema', '/schema_version', 'schema_version must be an integer ≥ 1');
  }
  if (version > MAX_SUPPORTED_SCHEMA_VERSION) {
    return failure(
      'unsupported-version',
      '/schema_version',
      `version ${version} is not supported (maximum ${MAX_SUPPORTED_SCHEMA_VERSION}); update the editor`,
    );
  }

  // 2. Structure — JSON Schema.
  const validateSchema = SCHEMAS[version - 1];
  if (!validateSchema(data)) {
    const issues: ValidationIssue[] = (validateSchema.errors ?? []).map((err) => ({
      category: 'schema',
      path: err.instancePath,
      message: err.message ?? 'schema violation',
    }));
    return { ok: false, issues };
  }

  // 3. Semantics on top of the schema.
  const issues = semanticIssues(data as unknown as AnyDocument);
  return { ok: issues.length === 0, issues };
}

type AnyDocument = ToonDocumentV1 | ToonDocumentV2 | ToonDocumentV3;

/** Validates and types already-parsed JSON, migrating v1 → v2 → v3; throws FormatError. */
export function loadDocument(data: unknown): ToonDocumentV3 {
  const result = validateDocument(data);
  if (!result.ok) {
    throw new FormatError(result.issues);
  }
  const doc = structuredClone(data) as AnyDocument;
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

function failure(category: ValidationCategory, path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ category, path, message }] };
}

function semanticIssues(doc: AnyDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let totalPoints = 0;
  const toolCount = doc.schema_version === 1 ? 0 : doc.tools.length;

  // v3 keeps cells per layer; v1/v2 are a single implicit layer at /frames.
  const cells: { path: string; frames: { strokes: { points: number[]; tool_id?: number }[] }[] }[] =
    doc.schema_version === 3
      ? doc.layers.map((layer, l) => ({ path: `/layers/${l}/frames`, frames: layer.frames }))
      : [{ path: '/frames', frames: doc.frames }];

  // The schema cannot express "every layer has the same number of frames".
  if (doc.schema_version === 3) {
    const expected = doc.layers[0].frames.length;
    doc.layers.forEach((layer, l) => {
      if (layer.frames.length !== expected) {
        issues.push({
          category: 'semantic',
          path: `/layers/${l}/frames`,
          message: `layer has ${layer.frames.length} frames; every layer must have ${expected}`,
        });
      }
    });
  }

  for (const { path, frames } of cells) {
    frames.forEach((frame, f) => {
      frame.strokes.forEach((stroke, s) => {
        const base = `${path}/${f}/strokes/${s}`;
        if (stroke.points.length % 2 !== 0) {
          issues.push({
            category: 'semantic',
            path: `${base}/points`,
            message: `coordinate count must be even (x,y pairs), got ${stroke.points.length}`,
          });
          return;
        }
        totalPoints += stroke.points.length / 2;
        if (stroke.tool_id !== undefined && stroke.tool_id >= toolCount) {
          issues.push({
            category: 'semantic',
            path: `${base}/tool_id`,
            message: `tool_id ${stroke.tool_id} does not reference an existing tool`,
          });
        }
        stroke.points.forEach((coord, i) => {
          // The schema enforces integers and the int16 range for JSON
          // input; Number.isInteger guards NaN in documents built in
          // memory, bypassing the operations module. Points may lie
          // outside the canvas: strokes can leave it and come back.
          if (!Number.isInteger(coord)) {
            issues.push({
              category: 'semantic',
              path: `${base}/points/${i}`,
              message: `coordinate must be an integer, got ${coord}`,
            });
          }
        });
      });
    });
  }

  if (totalPoints > MAX_TOTAL_POINTS) {
    issues.push({
      category: 'semantic',
      path: '',
      message: `document contains ${totalPoints} points — over the limit of ${MAX_TOTAL_POINTS}`,
    });
  }

  return issues;
}
