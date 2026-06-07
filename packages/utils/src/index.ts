export function deepMerge<T extends Record<string, unknown>, S extends Record<string, unknown>>(
  target: T,
  source: S,
): T & S {
  const result = { ...target } as T & S;
  for (const key of Object.keys(source) as (keyof S)[]) {
    const val = source[key];
    if (val !== undefined) {
      (result as Record<string, unknown>)[key as string] = val;
    }
  }
  return result;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function noop(): void {}

export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}
