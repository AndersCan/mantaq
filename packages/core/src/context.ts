export class Context<T> {
  #get: () => T;
  #set: (value: T) => void;

  constructor(get: () => T, set: (value: T) => void) {
    this.#get = get;
    this.#set = set;
  }

  get(): T {
    return this.#get();
  }

  set(value: T): void {
    this.#set(value);
  }
}
