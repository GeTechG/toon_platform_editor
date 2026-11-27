import { expect, test } from 'bun:test';
import { createDocument } from '../model/operations';
import { decodeProject, encodeProject } from './project';
import type { ToonDocument } from './types';

// A lossless WebP with two distinct opaque pixels.
const webp = Uint8Array.fromBase64('UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAA+w//Mf8x8VMqL/AQA=');
const hash = '4b23c031ae6c12e8d0f76e5d2161749f4a1f92e515c5b7c44eafa4b404fed421';

function mixedProject(): ToonDocument {
  const doc = createDocument();
  doc.layers.push({
    hidden: false,
    kind: 'raster',
    frames: [{ strokes: [], raster: { hash, x: 120, y: 70, width: 2, height: 1 } }],
  });
  return doc;
}

test('a mixed project opens with its original drawing in a fresh browser', async () => {
  const doc = mixedProject();
  const file = await encodeProject(doc, async (key) =>
    key === hash ? new Blob([webp], { type: 'image/webp' }) : undefined
  );
  const reopened = await decodeProject(file);

  expect(reopened.doc).toEqual(doc);
  expect(new Uint8Array(await reopened.assets.get(hash)!.arrayBuffer())).toEqual(webp);
});

test('an altered raster image makes the mixed project unreadable', async () => {
  const file = await encodeProject(mixedProject(), async () => new Blob([webp]));
  const altered = new Uint8Array(await file.arrayBuffer());
  altered[altered.length - 3] ^= 1;

  await expect(decodeProject(new Blob([altered]))).rejects.toThrow('does not match');
});

test('a plain vector JSON project remains portable', async () => {
  const doc = createDocument();
  const file = await encodeProject(doc);

  expect(JSON.parse(await file.text())).toEqual(doc);
  expect((await decodeProject(file)).doc).toEqual(doc);
});

test('a newer binary project reports the version from its manifest', async () => {
  const file = await encodeProject(mixedProject(), async () => new Blob([webp]));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const prefix = '"schema_version":';
  const version = new TextDecoder().decode(bytes).indexOf(prefix) + prefix.length;
  bytes[version] = '9'.charCodeAt(0);
  await expect(decodeProject(new Blob([bytes]))).rejects.toMatchObject({ unsupportedVersion: 9 });
});
