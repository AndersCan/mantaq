import { machine } from "@mantaq/core";
import { label, options } from "./x.ts";
import { made } from "./mid.ts";

export const app = machine("app", {
  create: () => {
    console.log(label(), options().retries);
    return made();
  },
});
