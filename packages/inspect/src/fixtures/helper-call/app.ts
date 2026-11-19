import { machine } from "@mantaq/core";
import { label } from "./x.ts";
import { made } from "./mid.ts";

/** A title from a helper in x.ts; the root never runs x.ts's actor, which also has (idle, go). */
export const title = label();

/** Runs Y (from mid.ts). */
export const app = machine("app", {
  create: () => made(),
});
