export type Left<L> = readonly [L, undefined];
export type Right<R> = readonly [undefined, R];

export type Either<L, R> = Left<L> | Right<R>;

type LeftOf<E> = E extends readonly [infer L, undefined] ? L : never;
type RightOf<E> = E extends readonly [undefined, infer R] ? R : never;

function isLeft<L, R>(e: Either<L, R>): e is Left<L> {
  return e[0] !== undefined;
}

function isRight<L, R>(e: Either<L, R>): e is Right<R> {
  return e[1] !== undefined;
}

/**
 * Either — an error/value pair as a plain 2-tuple.
 *
 * Left is `[value, undefined]`, right is `[undefined, value]`. Exactly one
 * slot is populated, so the predicates are a single array-index undefined
 * check. Side values must not be undefined or null — undefined is the
 * sentinel and is rejected at construction time.
 */
export const Either = {
  left<L extends {}>(value: L): Left<L> {
    return [value, undefined];
  },

  right<R extends {}>(value: R): Right<R> {
    return [undefined, value];
  },

  from<R>(fn: () => R): Either<unknown, R> {
    try {
      const value = fn();
      if (value === undefined || value === null) {
        return [
          new Error(
            `[mantaq/utils] Either.from received ${value}; null and undefined are not valid Right values`,
          ),
          undefined,
        ];
      }
      return [undefined, value];
    } catch (error) {
      return [error ?? new Error("thrown value was undefined"), undefined];
    }
  },

  isLeft<L, R>(e: Either<L, R>): e is Left<L> {
    return e[0] !== undefined;
  },

  isRight<L, R>(e: Either<L, R>): e is Right<R> {
    return e[1] !== undefined;
  },

  getLeft<E extends Either<LeftOf<E>, RightOf<E>>>(e: E): LeftOf<E> | undefined {
    return e[0];
  },

  getRight<E extends Either<LeftOf<E>, RightOf<E>>>(e: E): RightOf<E> | undefined {
    return e[1];
  },

  leftOrThrow<E extends Either<LeftOf<E>, RightOf<E>>>(e: E): LeftOf<E> {
    if (isLeft<LeftOf<E>, RightOf<E>>(e)) return e[0];
    throw new Error("[mantaq/utils] expected Either left, got right");
  },

  rightOrThrow<E extends Either<LeftOf<E>, RightOf<E>>>(e: E): RightOf<E> {
    if (isRight<LeftOf<E>, RightOf<E>>(e)) return e[1];
    throw new Error("[mantaq/utils] expected Either right, got left");
  },

  match<E extends Either<LeftOf<E>, RightOf<E>>, T>(
    e: E,
    onLeft: (value: LeftOf<E>) => T,
    onRight: (value: RightOf<E>) => T,
  ): T {
    return isLeft<LeftOf<E>, RightOf<E>>(e) ? onLeft(e[0]) : onRight(e[1]);
  },

  map<E extends Either<LeftOf<E>, RightOf<E>>, T>(
    e: E,
    fn: (value: RightOf<E>) => T,
  ): Either<LeftOf<E>, T> {
    if (isLeft<LeftOf<E>, RightOf<E>>(e)) return e;
    return [undefined, fn(e[1])];
  },

  mapLeft<E extends Either<LeftOf<E>, RightOf<E>>, T>(
    e: E,
    fn: (value: LeftOf<E>) => T,
  ): Either<T, RightOf<E>> {
    if (isLeft<LeftOf<E>, RightOf<E>>(e)) return [fn(e[0]), undefined];
    return e;
  },

  chain<E extends Either<LeftOf<E>, RightOf<E>>, T>(
    e: E,
    fn: (value: RightOf<E>) => Either<LeftOf<E>, T>,
  ): Either<LeftOf<E>, T> {
    if (isLeft<LeftOf<E>, RightOf<E>>(e)) return e;
    return fn(e[1]);
  },

  getOrElse<E extends Either<LeftOf<E>, RightOf<E>>>(
    e: E,
    onLeft: (value: LeftOf<E>) => RightOf<E>,
  ): RightOf<E> {
    return isLeft<LeftOf<E>, RightOf<E>>(e) ? onLeft(e[0]) : e[1];
  },

  swap<E extends Either<LeftOf<E>, RightOf<E>>>(e: E): Either<RightOf<E>, LeftOf<E>> {
    return isLeft<LeftOf<E>, RightOf<E>>(e) ? [undefined, e[0]] : [e[1], undefined];
  },

  tap<E extends Either<LeftOf<E>, RightOf<E>>>(e: E, fn: (value: RightOf<E>) => void): E {
    if (isRight<LeftOf<E>, RightOf<E>>(e)) fn(e[1]);
    return e;
  },
} as const;
