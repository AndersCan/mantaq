import { machine } from "@mantaq/core";
import { routerMachine } from "./router.ts";
import { syncMachine } from "./sync.design-a.ts";

/** A draft that copies `sync.ts` while `router.ts` still imports the original; parts made with `.create()`, as in justus. */
export const draft = machine("draft", {
  create: () => (Math.random() > 2 ? routerMachine.create() : syncMachine.create()),
});
