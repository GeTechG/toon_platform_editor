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
import { upgradeDocument } from './upgrade';

// The migrations live in ./upgrade — ajv-free, so the share page's player can
// lift an old document without pulling the validator into the viewer bundle.
export { migrateLegacyEraser, migrateV1ToV2, migrateV2ToV3, upgradeDocument } from './upgrade';

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
  return upgradeDocument(structuredClone(data) as AnyDocument);
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
