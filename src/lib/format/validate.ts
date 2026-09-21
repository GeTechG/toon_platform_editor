/**
 * Document validation: JSON Schema (ajv, draft 2020-12) plus semantic
 * checks the schema cannot express. The schema is the single source of
 * structural validation, shared with the future Rust implementation
 * (phase 2).
 */

import Ajv2020 from 'ajv/dist/2020';
import schema from './schema/toon-v7.schema.json';
import { SCHEMA_VERSION, MAX_TOTAL_POINTS } from './constants';
import type { ToolDescriptor, ToonDocument } from './types';

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
const validateSchema = ajv.compile(schema);

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
  // One version, no migrations: a document of any other version is not this
  // format, and guessing at it would draw a picture nobody made.
  if (version !== SCHEMA_VERSION) {
    return failure(
      'unsupported-version',
      '/schema_version',
      `version ${version} is not supported (this editor reads ${SCHEMA_VERSION} only)`,
    );
  }

  // 2. Structure — JSON Schema.
  if (!validateSchema(data)) {
    const issues: ValidationIssue[] = (validateSchema.errors ?? []).map((err) => ({
      category: 'schema',
      path: err.instancePath,
      message: err.message ?? 'schema violation',
    }));
    return { ok: false, issues };
  }

  // 3. Semantics on top of the schema.
  const issues = semanticIssues(data as unknown as ToonDocument);
  return { ok: issues.length === 0, issues };
}

/** Validates and types already-parsed JSON; throws FormatError. */
export function loadDocument(data: unknown): ToonDocument {
  const result = validateDocument(data);
  if (!result.ok) {
    throw new FormatError(result.issues);
  }
  return structuredClone(data) as ToonDocument;
}

function failure(category: ValidationCategory, path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ category, path, message }] };
}

function semanticIssues(doc: ToonDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let totalPoints = 0;
  const toolCount = doc.tools.length;

  const cells = doc.layers.map((layer, l) => ({
    path: `/layers/${l}/frames`,
    frames: layer.frames,
  }));

  // The schema cannot express "every layer has the same number of frames".
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
        // A cubic stroke is a start point plus whole segments of six numbers;
        // anything else would leave the reader with half a curve in hand.
        const tool: ToolDescriptor | undefined = doc.tools[stroke.tool_id];
        if (tool?.geometry === 'cubic' && (stroke.points.length - 2) % 6 !== 0) {
          issues.push({
            category: 'semantic',
            path: `${base}/points`,
            message: `cubic geometry needs 2 + 6n coordinates, got ${stroke.points.length}`,
          });
        }
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
