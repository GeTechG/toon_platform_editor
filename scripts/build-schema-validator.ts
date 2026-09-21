/**
 * Compiles the document schema to a standalone validator, at build time.
 *
 * ajv generates validation code from a schema; doing that in the browser cost
 * 33ms of code generation on every editor load, 16ms more to load the compiler
 * and ~120KB of it in the chunk — and it generates with `new Function`, which a
 * strict CSP forbids. The schema is checked in, so its validator can be too.
 *
 * Run `bun run schema` after changing the schema. A test regenerates and
 * compares, so a stale validator cannot reach a commit unnoticed.
 */
import Ajv2020 from 'ajv/dist/2020';
import standaloneCode from 'ajv/dist/standalone';
import ucs2length from 'ajv/dist/runtime/ucs2length';
import schema from '../src/lib/format/schema/toon-v7.schema.json';

/** The generated module, beside the schema it comes from. */
export const VALIDATOR_PATH = new URL('../src/lib/format/schema/toon-v7.validate.js', import.meta.url)
  .pathname;

const BANNER = `// Generated from toon-v7.schema.json by scripts/build-schema-validator.ts.
// Do not edit: run \`bun run schema\` instead.
`;

/**
 * ajv's runtime helpers come out as `require(...)` even in ESM mode — a
 * ReferenceError in a browser, and a reason to keep ajv installed for the sake
 * of a fifteen-line function. Each one is replaced by its own source, taken
 * from the ajv that generated the code, so the two cannot drift apart.
 *
 * `ucs2length` is the only one this schema reaches (it counts code points for
 * `minLength`/`maxLength`). A `require` left after this means a new helper
 * appeared — a format, a custom keyword — and the test says so.
 */
const RUNTIME_HELPERS: { code: string; source: { toString(): string } }[] = [
  { code: 'require("ajv/dist/runtime/ucs2length").default', source: ucs2length },
];

function inlineRuntimeHelpers(code: string): string {
  return RUNTIME_HELPERS.reduce(
    (out, { code: call, source }) => out.split(call).join(`(${source.toString()})`),
    code,
  );
}

export async function generateValidator(): Promise<string> {
  // `allErrors` matches what validate.ts asked the runtime compiler for: the
  // format error names every problem at once, not only the first.
  const ajv = new Ajv2020({ allErrors: true, code: { source: true, esm: true } });
  return BANNER + inlineRuntimeHelpers(standaloneCode(ajv, ajv.compile(schema)));
}

if (import.meta.main) {
  await Bun.write(VALIDATOR_PATH, await generateValidator());
  console.log(`wrote ${VALIDATOR_PATH}`);
}
