// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { serializeViz } from "@mantaq/viz";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { photoQueueMachine } from "../../../apps/docs/src/content/docs/photo-queue.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";
import { sendVia } from "./send-via.ts";

const file = join(import.meta.dirname, "../../../apps/docs/src/content/docs/photo-queue.ts");

async function mounted(): Promise<HTMLElement> {
  const inspected = await inspectModule(file, {
    load: async () => ({ photoQueueMachine }),
    fuzz: false,
  });
  history.replaceState(null, "", "?");
  const root = document.createElement("div");
  document.body.append(root);
  mountDriven(root, {
    source: "test",
    text: serializeViz(vizDocument(inspected.machines)),
    targets: {
      photoQueue: () => {
        const clock = VirtualClock();
        const made = photoQueueMachine.create();
        return { actor: made.actor, clock, made };
      },
    },
  });
  return root;
}

function addThree(root: HTMLElement) {
  for (let index = 0; index < 3; index += 1) sendVia(root, "photoAdded");
}

const children = (root: HTMLElement): Array<{ key: string; state: string }> =>
  Array.from(root.querySelectorAll(".graph g.child-marker"))
    .map((node) => ({
      key: node.getAttribute("data-marker-key") ?? "",
      state: node.getAttribute("data-marker-state") ?? "",
    }))
    .sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));

describe("the docs photo queue on the live page", () => {
  test("three sends of photoAdded start p1, p2, p3", async () => {
    const root = await mounted();
    addThree(root);
    expect(children(root)).toEqual(
      ["p1", "p2", "p3"].map((key) => ({ key, state: "photos.sendingPhoto" })),
    );
  });

  test("uploadConfirmed goes to p1", async () => {
    const root = await mounted();
    addThree(root);
    root.querySelector<HTMLElement>('li[data-child-key="p1"]')?.click();
    sendVia(root, "uploadConfirmed");
    expect(children(root).find((each) => each.key === "p1")?.state).toBe("photos.photoSent");
    expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
      "uploadConfirmed: p1 sendingPhoto → photoSent",
    );
  });

  test("queueCleared names every removed child", async () => {
    const root = await mounted();
    addThree(root);
    sendVia(root, "queueCleared");
    expect(children(root)).toEqual([]);
  });
});
