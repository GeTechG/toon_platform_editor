/**
 * Canonical serialization per RFC 8785 (JCS) for the JSON subset used by
 * the format: objects, arrays, strings, integers.
 *
 * Booleans (layer `hidden`) serialize as the JSON literals.
 * Floats are forbidden in the format, so the hardest part of JCS
 * (ECMAScript floating-point number serialization) is not needed: safe
 * integers serialize as String(n). Strings go through JSON.stringify
 * (matches RFC 8785 §3.2.2.2), object keys are sorted by UTF-16 code
 * units (the default Array#sort order).
 *
 * Deliberately free of runtime imports: also used by the fixture
 * generator under Node (type stripping).
 */

export function canonicalize(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(
        `canonical subset allows only integers (safe range), got: ${value}`,
      );
    }
    // String(-0) === '0' — matches the ECMAScript ToString required by RFC 8785.
    return String(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalize(item)).join(',') + ']';
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const members = keys.map((key) => JSON.stringify(key) + ':' + canonicalize(record[key]));
    return '{' + members.join(',') + '}';
  }
  throw new TypeError(`type outside the canonical format subset: ${value === null ? 'null' : typeof value}`);
}
