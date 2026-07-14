/**
 * Document validation: JSON Schema (ajv, draft 2020-12) plus semantic
 * checks the schema cannot express. The schema is the single source of
 * structural validation, shared with the future Rust implementation
 * (phase 2).
 */

import Ajv2020 from 'ajv/dist/2020';
import schema from './schema/toon-v1.schema.json';
import { MAX_TOTAL_POINTS, SCHEMA_VERSION } from './constants';
import type { ToonDocument } from './types';

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
  if (version > SCHEMA_VERSION) {
    return failure(
      'unsupported-version',
      '/schema_version',
      `version ${version} is not supported (maximum ${SCHEMA_VERSION}); update the editor`,
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
  return data as ToonDocument;
}

function failure(category: ValidationCategory, path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ category, path, message }] };
}

function semanticIssues(doc: ToonDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let totalPoints = 0;

  doc.frames.forEach((frame, f) => {
    frame.strokes.forEach((stroke, s) => {
      const base = `/frames/${f}/strokes/${s}`;
      if (stroke.points.length % 2 !== 0) {
        issues.push({
          category: 'semantic',
          path: `${base}/points`,
          message: `coordinate count must be even (x,y pairs), got ${stroke.points.length}`,
        });
        return;
      }
      totalPoints += stroke.points.length / 2;
      stroke.points.forEach((coord, i) => {
        // The schema already enforces integers for JSON input;
        // Number.isInteger guards documents built in memory,
        // bypassing the operations module.
        if (!Number.isInteger(coord)) {
          issues.push({
            category: 'semantic',
            path: `${base}/points/${i}`,
            message: `coordinate must be an integer, got ${coord}`,
          });
          return;
        }
        const limit = i % 2 === 0 ? doc.width : doc.height;
        const axis = i % 2 === 0 ? 'x' : 'y';
        if (coord < 0 || coord > limit) {
          issues.push({
            category: 'semantic',
            path: `${base}/points/${i}`,
            message: `${axis} = ${coord} is outside the canvas 0..${limit}`,
          });
        }
      });
    });
  });

  if (totalPoints > MAX_TOTAL_POINTS) {
    issues.push({
      category: 'semantic',
      path: '',
      message: `document contains ${totalPoints} points — over the limit of ${MAX_TOTAL_POINTS}`,
    });
  }

  return issues;
}
