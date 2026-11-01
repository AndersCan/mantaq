/**
 * Entry of the live page the `@mantaq/inspect/vite` plugin serves. Reads the
 * document URL from `#app[data-src]` and redraws, keeping the walk, whenever
 * the dev server reports that a machine file changed.
 */
import { UPDATE_EVENT } from "../html.ts";
import { mountLive } from "./page.ts";

const root = document.querySelector<HTMLElement>("#app");
const source = root?.dataset["src"];
if (root && source !== undefined) {
  const draw = () => void mountLive(root, source);
  draw();
  import.meta.hot?.on(UPDATE_EVENT, draw);
}
