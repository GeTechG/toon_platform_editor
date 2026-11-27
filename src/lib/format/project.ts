import type { RasterCel, ToonDocument } from './types';
import { hasRasterLayers, loadStudioDocument, rasterInventory } from './studio-document';
import { loadDocument } from './validate';

const MAGIC = new TextEncoder().encode('TOONOP\x00\x01');
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024;
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const WORD_BYTES = 4;

export type ReadRasterAsset = (hash: string) => Promise<Blob | undefined>;

export async function hashRasterBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function word(value: number): ArrayBuffer {
  const buffer = new ArrayBuffer(WORD_BYTES);
  new DataView(buffer).setUint32(0, value, true);
  return buffer;
}

/** Store WebP files as Blob parts: the archive never recompresses them. */
export async function encodeProject(doc: ToonDocument, read?: ReadRasterAsset): Promise<Blob> {
  if (!hasRasterLayers(doc)) return new Blob([JSON.stringify(doc)], { type: 'application/octet-stream' });
  const manifest = new TextEncoder().encode(JSON.stringify(doc));
  if (manifest.length > MAX_MANIFEST_BYTES) throw new Error('Project manifest is too large');
  const parts: BlobPart[] = [MAGIC, word(manifest.length), manifest];
  for (const [hash] of rasterInventory(doc)) {
    const image = await read?.(hash);
    if (!image || image.size === 0 || image.size > MAX_IMAGE_BYTES) throw new Error('Raster image is unavailable');
    parts.push(word(image.size), image);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** Validate the still's container, its VP8L dimensions, and its content hash. */
export async function checkRasterImage(blob: Blob, cel: RasterCel): Promise<void> {
  const bytes = await blob.arrayBuffer();
  const header = new DataView(bytes);
  if (bytes.byteLength < 26 ||
      header.getUint32(0) !== 0x52494646 ||
      header.getUint32(4, true) + 8 !== bytes.byteLength ||
      header.getUint32(8) !== 0x57454250 ||
      header.getUint32(12) !== 0x5650384c ||
      header.getUint8(20) !== 0x2f) throw new Error('Invalid lossless WebP');
  const size = header.getUint32(16, true);
  const bits = header.getUint32(21, true);
  if (size < 5 || 20 + size + (size % 2) !== bytes.byteLength || bits >>> 29 !== 0 ||
      (bits & 0x3fff) + 1 !== cel.width || ((bits >>> 14) & 0x3fff) + 1 !== cel.height ||
      await hashRasterBytes(bytes) !== cel.hash) throw new Error('Raster image does not match the project');
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
    } catch {
      throw new Error('Raster image cannot be decoded');
    }
  }
}

export async function decodeProject(file: Blob): Promise<{ doc: ToonDocument; assets: Map<string, Blob> }> {
  const prefix = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer());
  const assets = new Map<string, Blob>();
  if (prefix.length !== MAGIC.length || !MAGIC.every((byte, index) => byte === prefix[index])) {
    return { doc: loadDocument(JSON.parse(await file.text()), { owned: true }), assets };
  }

  let offset = MAGIC.length;
  async function nextPart(limit: number, type?: string): Promise<Blob> {
    if (offset + WORD_BYTES > file.size) throw new Error('Truncated project archive');
    const lengthBytes = await file.slice(offset, offset + WORD_BYTES).arrayBuffer();
    const length = new DataView(lengthBytes).getUint32(0, true);
    offset += WORD_BYTES;
    if (length === 0 || length > limit || offset + length > file.size) throw new Error('Invalid project part size');
    const part = file.slice(offset, offset + length, type);
    offset += length;
    return part;
  }

  const manifest = await nextPart(MAX_MANIFEST_BYTES);
  const doc = loadStudioDocument(JSON.parse(await manifest.text()), { owned: true });
  if (!hasRasterLayers(doc)) throw new Error('Archive requires a raster layer');
  for (const [hash, cel] of rasterInventory(doc)) {
    const image = await nextPart(MAX_IMAGE_BYTES, 'image/webp');
    await checkRasterImage(image, cel);
    assets.set(hash, image);
  }
  if (offset !== file.size) throw new Error('Unexpected data at end of project');
  return { doc, assets };
}
