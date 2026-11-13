/**
 * Entry of the frame page `@mantaq/inspect/vite` serves at `<base>preview`.
 * Draws the app's own `<machine file>.preview.ts` for the state in the address.
 * A bad address or a throw leaves the frame blank, with the error in the console.
 */
import { previews } from "virtual:mantaq/previews";

const query = new URLSearchParams(location.search);
const machine = query.get("machine") ?? "";
const load = previews[machine];
if (load !== undefined) {
  const { default: draw } = await load();
  const element = document.createElement("div");
  document.body.append(element);
  draw(element, JSON.parse(query.get("state") ?? "null"));
}
