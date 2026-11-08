import "@mantaq/viz/viewer.css";
import { targets } from "virtual:mantaq/targets";
import { mountDriven } from "../live-page.ts";

for (const root of document.querySelectorAll<HTMLElement>(".mantaq-machine")) {
  const text = root.dataset["mantaqViz"];
  if (text !== undefined) {
    const raw = root.dataset["mantaqRoutes"];
    mountDriven(root, {
      source: root.dataset["mantaqSrc"] ?? "machine",
      text,
      targets,
      heading: "h2",
      ...(raw === undefined ? {} : { routes: JSON.parse(raw) }),
    });
  }
}
