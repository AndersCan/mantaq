export interface Context<T> {
  get(): T;
  set(value: T): void;
}

/** Two-way handle over an owner's context: reads see live values, writes flag dirty state upstream. */
export function Context<T>(options: { get: () => T; set: (value: T) => void }): Context<T> {
  return {
    get: options.get,
    set: options.set,
  };
}
