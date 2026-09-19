/**
 * `.toonop` round-trip: the file is the document as-is, so saving and
 * opening must be the identity. Guarded twice — structurally on the
 * fixture corpus, and by rendering the decoded `.toon` documents before
 * and after a trip through JSON.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
import { canonicalize } from './canonical';
import type { ToonDocument } from './types';
import { decodeToon } from './toon-decode';
import { loadDocument } from './validate';

const VALID_DIR = join(import.meta.dir, 'fixtures/valid');

/** Records every property assignment and call, so two renders compare as text. */
function recordingCtx(): { ctx: Canvas2DLike; log: string[] } {
  const log: string[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(
    { canvas: { width: 1280, height: 720 } },
    {
      get(target: Record<string, unknown>, key: string) {
        if (key === 'canvas') return target.canvas;
        if (key in props) return props[key];
        return (...args: unknown[]) => {
          log.push(`${key}(${args.join(',')})`);
        };
      },
      set(_target, key: string, value: unknown) {
        props[key] = value;
        log.push(`${key}=${String(value)}`);
        return true;
      },
    },
  ) as unknown as Canvas2DLike;
  return { ctx, log };
}

function renderLog(doc: ToonDocument, frame: number): string[] {
  const { ctx, log } = recordingCtx();
  const scratch = () => {
    const inner = recordingCtx();
    return { ctx: inner.ctx, image: {} as CanvasImageSource };
  };
  new Canvas2DFrameRenderer(scratch).render(doc, frame, ctx, { scale: 1, dpr: 1 });
  return log;
}

/** Builds a `.toon` body the way the reference writer does (Int16 words). */
const toon = (words: number[]) => Int16Array.from(words).buffer;
const PENCIL = [1, 5, 0, 0, 0];

const toonFixtures: Record<string, ArrayBuffer> = {
  'one line': toon([
    1, 1, 12, 999, 5, 0,
    1, ...PENCIL,
    1, 0,
    0, 1,
    0, 3, 10, 20, 30, 40, 50, 60,
  ]),
  'two layers, two frames': toon([
    2, 2, 8, 999, 5, 0,
    2, ...PENCIL, 2, 7, 255, 0, 0, 0, 0, 255,
    1, 0,
    0, 1, 0, 2, 1, 2, 3, 4,
    1,
    0, 0,
    0, 1, 1, 2, 100, 100, 200, 200,
    0, 0,
  ]),
};

describe('.toonop round-trip', () => {
  const fixtures = readdirSync(VALID_DIR).filter(
    (name) => name.endsWith('.json') && !name.endsWith('.expected.json'),
  );

  it('the corpus is not empty', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
  });

  for (const name of fixtures) {
    it(`survives save and open unchanged: ${name}`, () => {
      const doc = loadDocument(JSON.parse(readFileSync(join(VALID_DIR, name), 'utf8')));
      // Canonical bytes, not deep-equal: `-0` spelled in a document comes back
      // as `0` through JSON, and the format calls those the same coordinate.
      expect(canonicalize(loadDocument(JSON.parse(JSON.stringify(doc))))).toBe(canonicalize(doc));
    });
  }

  for (const [name, buffer] of Object.entries(toonFixtures)) {
    it(`renders identically after a round-trip: ${name}`, () => {
      const result = decodeToon(buffer);
      if (!result.ok) throw new Error(result.error);
      const before = loadDocument(result.doc);
      const after = loadDocument(JSON.parse(JSON.stringify(before)));
      for (let frame = 0; frame < before.layers[0].frames.length; frame++) {
        const log = renderLog(before, frame);
        expect(log.length).toBeGreaterThan(4); // not a vacuous comparison
        expect(renderLog(after, frame)).toEqual(log);
      }
    });
  }
});
