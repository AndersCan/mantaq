/**
 * Retry counter: each failure bumps `attempts` in context and stays put; the
 * eleventh locks out. Reaching `lockedOut` needs the same event 11 times in a
 * row, which no single-event mutation finds by luck.
 */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

type RetryContext = { attempts: number };

const idle = state("idle")();
const connecting = state("connecting")();
const connected = state("connected")();
const lockedOut = state("lockedOut")();

const connect = event("connect")();
const reset = event("reset")();
const failed = event("failed")<{ reason: string }>();
const opened = event("opened")();

export function createRetryActor(clock: VirtualClock = VirtualClock()) {
  const initialContext: RetryContext = { attempts: 0 };
  return Actor({
    inputs: [connect, reset],
    internal: [failed, opened],
    states: [idle, connecting, connected, lockedOut],
    initial: idle,
    clock,
    context: initialContext,
    setup: (m) => {
      m.on(idle, { event: connect, to: [connecting], handler: () => ({ state: connecting }) });
      m.on(connecting, {
        event: failed,
        to: [lockedOut],
        handler: (_event, { context }) => {
          const current = context.get();
          current.attempts += 1;
          context.set(current);
          if (current.attempts > 10) return { state: lockedOut };
          return {};
        },
      });
      m.on(connecting, {
        event: opened,
        to: [connected],
        handler: (_event, { context }) => {
          const current = context.get();
          current.attempts = 0;
          context.set(current);
          return { state: connected };
        },
      });
      m.on(lockedOut, {
        event: reset,
        to: [idle],
        handler: (_event, { context }) => {
          const current = context.get();
          current.attempts = 0;
          context.set(current);
          return { state: idle };
        },
      });
    },
  });
}
