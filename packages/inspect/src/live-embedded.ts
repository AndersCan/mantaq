/**
 * Entry of the standalone live page `mantaq-inspect --live` writes: the viz
 * document sits in the page, the machines are bundled in, nothing is fetched.
 */
import { DOCUMENT_ELEMENT_ID } from "@mantaq/viz";
import { targets } from "virtual:mantaq/targets";
import { mountDriven } from "./live-page.ts";

const root = document.querySelector<HTMLElement>("#app");
const text = document.getElementById(DOCUMENT_ELEMENT_ID)?.textContent;

if (root && text) mountDriven(root, { source: "this page", text, targets });
