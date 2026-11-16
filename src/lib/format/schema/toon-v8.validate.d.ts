/**
 * Typings for the generated standalone validator. ajv emits plain JavaScript,
 * so this says what it is — the way `gifenc.d.ts` does for the GIF encoder.
 * Sits beside the .js file, so `./toon-v7.validate.js` resolves to it.
 */
export interface SchemaError {
  /** JSON Pointer to the invalid value. */
  instancePath: string;
  message?: string;
}

export interface SchemaValidator {
  (data: unknown): boolean;
  /** What the last call rejected; null or absent when it accepted. */
  errors?: SchemaError[] | null;
}

declare const validate: SchemaValidator;
export default validate;
