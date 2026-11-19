import { machine } from "@mantaq/core";
import { settings } from "./x.ts";
import { made } from "./mid.ts";

export const app = machine("app", {
  create: () => {
    console.log(settings.title());
    return made();
  },
});
