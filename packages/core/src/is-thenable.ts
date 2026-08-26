/**
 * Adopts a native Promise or any thenable (custom implementation, library
 * deferred) as a pending async effect.
 */
export function isThenable(value: unknown): value is Promise<unknown> {
  if (value instanceof Promise) return true;
  const candidate = value as { then?: unknown } | undefined;
  return (
    typeof candidate === "object" && candidate !== null && typeof candidate.then === "function"
  );
}
