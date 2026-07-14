import { describe, expect, it } from 'bun:test';
import { canonicalize } from './canonical';
import { sha256Hex } from './hash';

describe('canonicalize (RFC 8785, format subset)', () => {
  it('sorts object keys by UTF-16 code units', () => {
    expect(canonicalize({ b: 1, a: [{ z: 2, y: 'м' }] })).toBe('{"a":[{"y":"м","z":2}],"b":1}');
  });

  it('serializes strings like JSON.stringify (RFC 8785 escapes)', () => {
    expect(canonicalize({ s: 'a"b\n\t' })).toBe('{"s":"a\\"b\\n\\t"}');
  });

  it('serializes integers without exponent or fraction', () => {
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(-7)).toBe('-7');
    expect(canonicalize(-0)).toBe('0');
  });

  it('rejects values outside the subset: float, NaN, bool, null', () => {
    expect(() => canonicalize(1.5)).toThrow(TypeError);
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalize(true)).toThrow(TypeError);
    expect(() => canonicalize(null)).toThrow(TypeError);
    expect(() => canonicalize({ a: undefined })).toThrow(TypeError);
  });

  it('is independent of key order and formatting of the source JSON', () => {
    const a = JSON.parse('{"width":4800,"frames":[{"strokes":[]}],"schema_version":1,"height":2400,"frame_rate":12}');
    const b = JSON.parse('{ "frame_rate": 12,\n  "height": 2400, "schema_version": 1, "width": 4800, "frames": [ { "strokes": [] } ] }');
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('produces known canonical bytes and SHA-256 for the minimal document', async () => {
    const doc = {
      schema_version: 1,
      width: 4800,
      height: 2400,
      frame_rate: 12,
      frames: [{ strokes: [] }],
    };
    const canonical = canonicalize(doc);
    // String verified by hand, hash via sha256sum (independent of WebCrypto).
    expect(canonical).toBe(
      '{"frame_rate":12,"frames":[{"strokes":[]}],"height":2400,"schema_version":1,"width":4800}',
    );
    expect(await sha256Hex(canonical)).toBe(
      '57718cc72b245bf00500c0f630a82a0ab760d414210474999f16cd64793735b2',
    );
  });

  it('changes the hash when a single coordinate changes', async () => {
    const base = {
      schema_version: 1,
      width: 4800,
      height: 2400,
      frame_rate: 12,
      frames: [{ strokes: [{ points: [10, 20, 30, 40], width: 32, color: '#000000' }] }],
    };
    const changed = structuredClone(base);
    changed.frames[0].strokes[0].points[3] = 41;
    expect(await sha256Hex(canonicalize(base))).not.toBe(await sha256Hex(canonicalize(changed)));
  });
});

describe('sha256Hex', () => {
  it('matches known SHA-256 vectors', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
