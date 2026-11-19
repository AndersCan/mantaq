import { machine } from "@mantaq/core";
import { xActor } from "./x.ts";
import { made } from "./mid.ts";

/** An actor from x.ts, built in an object literal outside `create`; the root never runs it, and it also has (idle, go). */
export const meta = { spare: xActor() };

/** Runs Y (from mid.ts). */
export const app = machine("app", {
  create: () => made(),
});
