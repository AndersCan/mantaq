/** Entry of the self-contained static page. */
import { mountEmbedded } from "./page.ts";
import "./page.css";

const root = document.querySelector<HTMLElement>("#app");
if (root) mountEmbedded(root);
