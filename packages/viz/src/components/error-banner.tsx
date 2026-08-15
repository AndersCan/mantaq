/**
 * ErrorBanner — error surface (specs/error-banner.md).
 *
 * - `{ kind: "graph" } | { kind: "actor" }` discriminated union,
 * - `role="alert"` + `aria-live="assertive"`,
 * - graph errors carry a copy button (actor errors are transient, not
 *   actionable — no copy),
 * - no auto-dismiss: the banner stays until the next successful render or an
 *   explicit dismiss,
 * - every state renders: visible / dismissed.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import type { VizError } from "../model/use-actor-model.ts";

export interface ErrorBannerProps {
  error: VizError;
  onDismiss?: () => void;
}

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps): ReactNode {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const dismiss = (): void => {
    setDismissed(true);
    onDismiss?.();
  };

  const copy = (): void => {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      void navigator.clipboard.writeText(`${error.reason}: ${error.message}`);
    }
  };

  return (
    <div
      className="mtq-error-banner"
      role="alert"
      aria-live="assertive"
      data-error-kind={error.kind}
      data-dismissed="false"
    >
      <span className="mtq-error-banner__chip">{error.kind}</span>
      <span className="mtq-error-banner__reason">{error.reason}</span>
      <code className="mtq-error-banner__message">{error.message}</code>
      <span className="mtq-error-banner__actions">
        {error.kind === "graph" ? (
          <button type="button" className="mtq-error-banner__button" onClick={copy}>
            Copy
          </button>
        ) : null}
        <button type="button" className="mtq-error-banner__button" onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
  );
}
