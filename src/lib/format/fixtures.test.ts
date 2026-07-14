/**
 * Fixture corpus runner: 100% of valid fixtures are accepted (with
 * canonical bytes and SHA-256 matching), 100% of invalid fixtures are
 * rejected with the expected error category. The corpus is the shared
 * contract for future implementations (Rust, phase 2).
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize } from './canonical';
import { sha256Hex } from './hash';
import { validateDocument, type ValidationCategory } from './validate';

function corpus(dir: string): Map<string, { doc: string; expected: string }> {
  const result = new Map<string, { doc: string; expected: string }>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || name.endsWith('.expected.json')) {
      continue;
    }
    const sidecar = join(dir, name.replace(/\.json$/, '.expected.json'));
    let expected: string;
    try {
      expected = readFileSync(sidecar, 'utf8');
    } catch {
      throw new Error(`missing sidecar file ${sidecar}`);
    }
    result.set(name, { doc: readFileSync(join(dir, name), 'utf8'), expected });
  }
  return result;
}

const VALID_DIR = join(import.meta.dir, 'fixtures/valid');
const INVALID_DIR = join(import.meta.dir, 'fixtures/invalid');
const validFixtures = corpus(VALID_DIR);
const invalidFixtures = corpus(INVALID_DIR);

describe('fixture corpus: valid', () => {
  it('corpus is not empty', () => {
    expect(validFixtures.size).toBeGreaterThanOrEqual(4);
  });

  for (const [name, { doc, expected }] of validFixtures) {
    it(`accepted and canonicalized: ${name}`, async () => {
      const parsed = JSON.parse(doc);
      const { canonical, sha256 } = JSON.parse(expected) as { canonical: string; sha256: string };
      expect(validateDocument(parsed)).toEqual({ ok: true, issues: [] });
      expect(canonicalize(parsed)).toBe(canonical);
      expect(await sha256Hex(canonicalize(parsed))).toBe(sha256);
    });
  }

  it('the same document with different key order hashes identically', async () => {
    const a = readFileSync(join(VALID_DIR, 'minimal.json'), 'utf8');
    const b = readFileSync(join(VALID_DIR, 'minimal-shuffled-keys.json'), 'utf8');
    expect(a).not.toBe(b);
    expect(await sha256Hex(canonicalize(JSON.parse(a)))).toBe(
      await sha256Hex(canonicalize(JSON.parse(b))),
    );
  });
});

describe('fixture corpus: invalid', () => {
  it('corpus is not empty', () => {
    expect(invalidFixtures.size).toBeGreaterThanOrEqual(8);
  });

  for (const [name, { doc, expected }] of invalidFixtures) {
    it(`rejected with the expected category: ${name}`, () => {
      const { category } = JSON.parse(expected) as { category: ValidationCategory };
      const result = validateDocument(JSON.parse(doc));
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.category)).toContain(category);
    });
  }
});
