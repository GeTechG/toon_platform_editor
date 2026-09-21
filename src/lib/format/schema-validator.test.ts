import { describe, expect, it } from 'bun:test';
import { generateValidator, VALIDATOR_PATH } from '../../../scripts/build-schema-validator';

// `ajv.compile(schema)` ran at module scope: 33ms of code generation on every
// editor load (measured on a desktop — on the 2GB Android PRODUCT.md names as
// the bar, several times that), before anything is drawable, plus 16ms to load
// the compiler itself and ~120KB of it in the editor's chunk. It generates that
// code with `new Function`, so the strict CSP app.css already assumes would
// have needed `unsafe-eval` to let the editor run at all.
//
// The compiler belongs at build time. The schema is checked in, so its
// validator can be too — and then the browser ships neither ajv nor an eval.
// The only new risk is the generated file drifting from the schema, which is
// what this test is: regenerate, compare, fail on any difference.
const committed = await Bun.file(VALIDATOR_PATH).text();

describe('the schema is compiled at build time, not at load', () => {
  it('the validator on disk is what the schema generates', async () => {
    expect(await generateValidator()).toBe(committed);
  });

  it('the generated module stands on its own', () => {
    // ajv emits its runtime helpers as `require(...)` even in ESM mode, which
    // is a ReferenceError in a browser and drags ajv back into the chunk for
    // the sake of a fifteen-line function. The generator inlines them. A new
    // `require` here means a new runtime dependency appeared and has to be
    // inlined too — better a failing test than a blank editor.
    expect(committed).not.toContain('require(');
  });

  it('nothing ships the code generator to the browser', async () => {
    const validate = await Bun.file(new URL('./validate.ts', import.meta.url)).text();
    expect(validate).not.toMatch(/from '.*\bajv\b/);
  });
});
