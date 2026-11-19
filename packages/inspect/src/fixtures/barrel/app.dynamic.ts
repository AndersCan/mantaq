import { machine } from "@mantaq/core";
import { syncActor } from "./sync.ts";

/** Calls a copy only through a dynamic import, which the import walk does not follow. */
export const later = () => import("./copy.ts").then((module) => module.syncActor());

export const app = machine("dynamic", {
  create: () => syncActor(),
});
