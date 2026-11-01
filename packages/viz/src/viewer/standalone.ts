/** Entry of the self-contained HTML page `mantaq-inspect` writes. */
import { mountEmbedded } from "./page.ts";

const root = document.querySelector<HTMLElement>("#app");
if (root) mountEmbedded(root);
