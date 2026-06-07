import { isAborted } from "@mantaq/utils";

type EmitFn = (event: { id: string; [key: string]: unknown }) => void;

export function onSuccess<T>(
  result: T,
  emit: EmitFn,
  event: (data: T) => { id: string; [key: string]: unknown },
): void {
  emit(event(result));
}

export function onError(
  err: unknown,
  emit: EmitFn,
  event: (err: unknown) => { id: string; [key: string]: unknown },
): void {
  emit(event(err));
}

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
      if (!isAborted(signal)) emit(events.success(data));
    })
    .catch((err) => {
      if (!isAborted(signal)) emit(events.error(err));
    });
}
