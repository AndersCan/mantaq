type AnyEvent = { type: string; payload?: unknown };

/** `Emit`: events the effect may send; follows the effect's `sends` list when declared. */
export interface WithPromiseOptions<T, Emit = AnyEvent> {
  promise: Promise<T>;
  signal: AbortSignal;
  emit: (event: Emit) => void;
  events: {
    success: (data: T) => NoInfer<Emit>;
    error: (err: unknown) => NoInfer<Emit>;
  };
}

export function withPromise<T, Emit = AnyEvent>(
  options: WithPromiseOptions<T, Emit>,
): Promise<void> {
  const { promise, signal, emit, events } = options;
  // Use the two-argument `then` so the rejection handler is bound ONLY to the
  // original `promise`. With `.then(...).catch(...)` the `.catch` also swallows
  // a throw from the success callback, mislabeling a success-path failure as a
  // promise rejection (issue #268).
  return promise.then(
    (data) => {
      if (!signal.aborted) emit(events.success(data));
    },
    (err) => {
      if (!signal.aborted) emit(events.error(err));
    },
  );
}
