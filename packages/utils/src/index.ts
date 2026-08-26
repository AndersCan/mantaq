export type Left<L> = readonly [L, undefined];
export type Right<R> = readonly [undefined, R];

export type Either<L, R> = Left<L> | Right<R>;

type LeftOf<E> = E extends readonly [infer L, undefined] ? L : never;
type RightOf<E> = E extends readonly [undefined, infer R] ? R : never;

function isLeft<L, R>(either: Either<L, R>): either is Left<L> {
  return either[0] !== undefined;
}

function isRight<L, R>(either: Either<L, R>): either is Right<R> {
  return either[1] !== undefined;
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

  isLeft,

  isRight,

  getLeft<E extends Either<LeftOf<E>, RightOf<E>>>(either: E): LeftOf<E> | undefined {
    return either[0];
  },

  getRight<E extends Either<LeftOf<E>, RightOf<E>>>(either: E): RightOf<E> | undefined {
    return either[1];
  },

  match<E extends Either<LeftOf<E>, RightOf<E>>, T>(
    either: E,
    handlers: { onLeft: (value: LeftOf<E>) => T; onRight: (value: RightOf<E>) => T },
  ): T {
    return isLeft<LeftOf<E>, RightOf<E>>(either)
      ? handlers.onLeft(either[0])
      : handlers.onRight(either[1]);
  },

  map<E extends Either<LeftOf<E>, RightOf<E>>, T>(
    either: E,
    transform: { onRight: (value: RightOf<E>) => T },
  ): Either<LeftOf<E>, T> {
    if (isLeft<LeftOf<E>, RightOf<E>>(either)) return either;
    return [undefined, transform.onRight(either[1])];
  },

  mapLeft<E extends Either<LeftOf<E>, RightOf<E>>, T>(
    either: E,
    transform: { onLeft: (value: LeftOf<E>) => T },
  ): Either<T, RightOf<E>> {
    if (isLeft<LeftOf<E>, RightOf<E>>(either)) return [transform.onLeft(either[0]), undefined];
    return either;
  },

  chain<E extends Either<LeftOf<E>, RightOf<E>>, T>(
    either: E,
    step: { onRight: (value: RightOf<E>) => Either<LeftOf<E>, T> },
  ): Either<LeftOf<E>, T> {
    if (isLeft<LeftOf<E>, RightOf<E>>(either)) return either;
    return step.onRight(either[1]);
  },

  getOrElse<E extends Either<LeftOf<E>, RightOf<E>>>(
    either: E,
    fallback: { onLeft: (value: LeftOf<E>) => RightOf<E> },
  ): RightOf<E> {
    return isLeft<LeftOf<E>, RightOf<E>>(either) ? fallback.onLeft(either[0]) : either[1];
  },

  swap<E extends Either<LeftOf<E>, RightOf<E>>>(either: E): Either<RightOf<E>, LeftOf<E>> {
    return isLeft<LeftOf<E>, RightOf<E>>(either) ? [undefined, either[0]] : [either[1], undefined];
  },

  tap<E extends Either<LeftOf<E>, RightOf<E>>>(
    either: E,
    visitor: { onRight: (value: RightOf<E>) => void },
  ): E {
    if (isRight<LeftOf<E>, RightOf<E>>(either)) visitor.onRight(either[1]);
    return either;
  },
};
