/**
 * Entry of the page `@mantaq/inspect/vite` serves. Redraws when the dev
 * server reports a change, and when the machine code itself hot-updates.
 */
import { UPDATE_EVENT } from "@mantaq/viz";
import { previewed, targets } from "virtual:mantaq/targets";
import { mountLiveDriven, readStorage, takeTargets } from "./live-page.ts";
import type { LiveTargets } from "./live-page.ts";

const root = document.querySelector<HTMLElement>("#app");
const source = root?.dataset["src"];
const current: { targets: LiveTargets; previewed: ReadonlyArray<string> } = {
  targets,
  previewed,
};

if (root && source !== undefined) {
  const notes =
    import.meta.hot === undefined
      ? undefined
      : new URL("notes", new URL(source, location.href)).pathname;
  const preview =
    import.meta.hot === undefined
      ? undefined
      : new URL("preview", new URL(source, location.href)).pathname;
  const draw = () => {
    const seen = import.meta.hot === undefined ? undefined : readStorage(() => sessionStorage);
    void mountLiveDriven(root, {
      source,
      targets: current.targets,
      ...(notes === undefined ? {} : { notes }),
      ...(preview === undefined ? {} : { preview: { path: preview, machines: current.previewed } }),
      ...(seen === undefined ? {} : { seen }),
    });
  };
  draw();
  import.meta.hot?.on(UPDATE_EVENT, draw);
  import.meta.hot?.accept("virtual:mantaq/targets", (module) => {
    if (module !== undefined) Object.assign(current, takeTargets(module));
    draw();
  });
}
