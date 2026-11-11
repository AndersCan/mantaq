import "@mantaq/viz/viewer.css";
import { targets } from "virtual:mantaq/targets";
import { mountDriven } from "../live-page.ts";

for (const root of document.querySelectorAll<HTMLElement>(".mantaq-machine")) {
  const text = root.dataset["mantaqViz"];
  if (text !== undefined) {
    const raw = root.dataset["mantaqRoutes"];
    const src = root.dataset["mantaqSrc"];
    mountDriven(root, {
      source: src ?? "machine",
      text,
      targets,
      heading: "h2",
      effectMode: root.dataset["mantaqEffects"] === "run" ? "real" : "held",
      diagramOnly: root.dataset["mantaqDiagramOnly"] !== undefined,
      ...(raw === undefined ? {} : { routes: JSON.parse(raw) }),
      ...(src === undefined ? {} : { copyNotes: { file: src } }),
    });
  }
}
