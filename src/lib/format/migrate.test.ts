import { describe, expect, it } from 'bun:test';
import type { ToonDocumentV1, ToonDocumentV2, ToonDocumentV3 } from './types';
import fixture from './fixtures/migration/v1-to-v2.golden.json';
import v3Fixture from './fixtures/migration/v2-to-v3.golden.json';
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

describe('v2 → v3 migration fixtures', () => {
  it('matches the golden result', () => {
    const input = structuredClone(v3Fixture.input) as ToonDocumentV2;
    expect(validation.migrateV2ToV3(input)).toEqual(v3Fixture.expected as ToonDocumentV3);
  });

  it('does not mutate the v2 source object', () => {
    const input = structuredClone(v3Fixture.input) as ToonDocumentV2;
    const before = structuredClone(input);
    validation.migrateV2ToV3(input);
    expect(input).toEqual(before);
  });

  it('loadDocument runs the whole v1 → v2 → v3 chain', () => {
    const loaded = validation.loadDocument(structuredClone(fixture.input));
    expect(loaded.schema_version).toBe(3);
    expect(loaded.layers).toHaveLength(1);
    expect(loaded.layers[0].frames).toEqual(
      (fixture.expected as ToonDocumentV2).frames as never,
    );
  });
});
