import { machine } from "@mantaq/core";
import { syncActor as far } from "./a.ts";
import { syncActor as near } from "./index.ts";

/** Calls the original through a barrel (2 imports) and a copy through a longer chain (3). */
export const app = machine("barrel", {
  create: () => (Math.random() > 2 ? far() : near()),
});
