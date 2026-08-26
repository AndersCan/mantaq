type EmitFn = (event: { type: string; payload?: unknown }) => void;

export function withPromise<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  emit: EmitFn,
  events: {
    success: (data: T) => { type: string; payload?: unknown };
    error: (err: unknown) => { type: string; payload?: unknown };
  },
): Promise<void> {
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
