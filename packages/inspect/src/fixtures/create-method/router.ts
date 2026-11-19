import { machine } from "@mantaq/core";
import { syncMachine } from "./sync.ts";

export const routerMachine = machine("router", { create: () => syncMachine.create() });
