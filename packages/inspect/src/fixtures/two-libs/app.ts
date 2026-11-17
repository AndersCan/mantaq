import { machine } from "@mantaq/core";
import { leftActor } from "./left.ts";
import { rightActor } from "./right.ts";

/** Both libraries register (idle, go); this file registers nothing. */
export const app = machine("app", {
  create: () => (Math.random() > 2 ? rightActor() : leftActor()),
});
