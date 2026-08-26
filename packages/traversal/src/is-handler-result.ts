/**
 * Type guard for untyped transition-handler results. The single sanctioned
 * `as` site for graph invocation: handler output crosses the untyped boundary.
 */

interface HandlerResult {
  state?: { name?: string };
  emit?: Array<{ type?: string }>;
}

export type { HandlerResult };

export function isHandlerResult(value: unknown): value is HandlerResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as HandlerResult;
  return (
    (candidate.state === undefined ||
      (typeof candidate.state === "object" &&
        candidate.state !== null &&
        typeof candidate.state.name === "string")) &&
    (candidate.emit === undefined || Array.isArray(candidate.emit))
  );
}
