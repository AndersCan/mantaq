import { machine } from "@mantaq/core";
import { helperName } from "./x.ts";
import { made } from "./mid.ts";

/** Runs Y (from mid.ts); imports only a name from x.ts, whose unrelated actor also has (idle, go). */
export const app = machine(`app-${helperName}`, {
  create: () => made(),
});
