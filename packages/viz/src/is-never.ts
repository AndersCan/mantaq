/**
 * The `default` of an exhaustive switch: a union member nobody handled is a bad
 * state, not an expected failure, so it throws rather than returning an Either.
 * Adding a member to the union turns the call into a compile error.
 */
export function isNever(value: never): never {
  throw new Error(`unhandled: ${JSON.stringify(value)}`);
}
