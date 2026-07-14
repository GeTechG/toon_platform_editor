/**
 * Generates sidecar files for valid fixtures: canonical bytes +
 * SHA-256. The hash uses node:crypto — independent of the runtime's
 * WebCrypto path (cross-check of hash.ts). Run:
 *   bun scripts/gen-fixture-expected.mjs
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { canonicalize } from '../src/lib/format/canonical.ts';

const dir = new URL('../src/lib/format/fixtures/valid/', import.meta.url);

for (const name of readdirSync(dir)) {
  if (!name.endsWith('.json') || name.endsWith('.expected.json')) {
    continue;
  }
  const raw = readFileSync(new URL(name, dir), 'utf8');
  const canonical = canonicalize(JSON.parse(raw));
  const sha256 = createHash('sha256').update(canonical, 'utf8').digest('hex');
  const sidecar = name.replace(/\.json$/, '.expected.json');
  writeFileSync(new URL(sidecar, dir), JSON.stringify({ canonical, sha256 }, null, 2) + '\n');
  console.log(`${sidecar}: ${sha256}`);
}
