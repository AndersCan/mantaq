import { machine } from "@mantaq/core";
import { routed } from "./router.ts";
import { syncActor } from "./sync.design-a.ts";

/** A draft that copies `sync.ts` while `router.ts` still imports the original. */
export const draft = machine("draft", {
  create: () => (Math.random() > 2 ? routed() : syncActor()),
});
