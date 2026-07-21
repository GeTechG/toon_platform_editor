import { describe, expect, it } from 'bun:test';
import type { ToonDocumentV1, ToonDocumentV2 } from './types';
import fixture from './fixtures/migration/v1-to-v2.golden.json';
import * as validation from './validate';

type Migrate = (doc: ToonDocumentV1) => ToonDocumentV2;
const migrateV1ToV2 = (validation as unknown as { migrateV1ToV2?: Migrate }).migrateV1ToV2;

describe('v1 → v2 migration fixtures', () => {
  it('exports a deterministic migration', () => {
    expect(migrateV1ToV2).toBeFunction();
  });

  it('preserves points and frame order while deduplicating Multator tools', () => {
    const input = structuredClone(fixture.input) as ToonDocumentV1;
    const beforePoints = input.frames.map((frame) => frame.strokes.map((stroke) => stroke.points.slice()));
    const migrated = migrateV1ToV2!(input);
    expect(migrated).toEqual(fixture.expected as ToonDocumentV2);
    expect(migrated.frames.map((frame) => frame.strokes.map((stroke) => stroke.points))).toEqual(beforePoints);
  });

  it('does not mutate the v1 source object', () => {
    const input = structuredClone(fixture.input) as ToonDocumentV1;
    const before = structuredClone(input);
    migrateV1ToV2!(input);
    expect(input).toEqual(before);
  });
});
