type EmitFn = (event: { id: string; [key: string]: unknown }) => void;

export function withPromise<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  emit: EmitFn,
  events: {
    success: (data: T) => { id: string; [key: string]: unknown };
    error: (err: unknown) => { id: string; [key: string]: unknown };
  },
): void {
  promise
    .then((data) => {
      if (!signal.aborted) emit(events.success(data));
    })
    .catch((err) => {
      if (!signal.aborted) emit(events.error(err));
    });
}
