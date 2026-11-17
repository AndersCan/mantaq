/** Only an actor instance: it cannot be recreated, so it is not a machine. */
import { VirtualClock } from "@mantaq/core";
import { retry as retryMachine } from "./retry.ts";

export const retry = retryMachine.create({ clock: VirtualClock() });
