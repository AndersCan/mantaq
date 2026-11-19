import { machine } from "@mantaq/core";
import { stage } from "./x.ts";
import { made } from "./mid.ts";

export const app = machine("app", {
  create: () => {
    console.log(stage().name);
    return made();
  },
});
