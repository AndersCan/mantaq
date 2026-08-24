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
  return promise
    .then((data) => {
      if (!signal.aborted) emit(events.success(data));
    })
    .catch((err) => {
      if (!signal.aborted) emit(events.error(err));
    });
}
