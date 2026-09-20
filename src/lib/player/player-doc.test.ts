import { describe, expect, it } from 'bun:test';
import { upgradeDocument } from '../format/upgrade';
import { frameCount } from '../model/operations';
import golden from '../format/fixtures/migration/v2-to-v3.golden.json';
import type { ToonDocumentV2 } from '../format/types';

// The share page hands the player whatever version was published — the API
// accepts v1 and v2 too, and those have no `layers`, so the renderer read
// `doc.layers[0]` of `undefined` and the page 500'd.
const source = await Bun.file(new URL('./Player.svelte', import.meta.url)).text();

describe('the player accepts every published document version', () => {
  it('lifts a v2 publication to v3 instead of crashing on its missing layers', () => {
    const v2 = structuredClone(golden.input) as ToonDocumentV2;

    const doc = upgradeDocument(v2);

    expect(doc.schema_version).toBe(6);
    expect(frameCount(doc)).toBe(v2.frames.length);
    expect(doc.layers[0].frames).toEqual(v2.frames);
  });

  it('renders the upgraded document, never the raw prop', () => {
    expect(source).toContain('upgradeDocument(doc)');
    expect(source).not.toMatch(/frameCount\(doc\)/);
  });
});
