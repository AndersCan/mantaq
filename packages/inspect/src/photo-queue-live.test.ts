// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { serializeViz } from "@mantaq/viz";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { createPhotoQueueActor } from "../../../apps/docs/src/content/docs/photo-queue.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";

const file = join(import.meta.dirname, "../../../apps/docs/src/content/docs/photo-queue.ts");

async function mounted(): Promise<HTMLElement> {
  const inspected = await inspectModule(file, {
    load: async () => ({ createPhotoQueueActor }),
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
        const made = createPhotoQueueActor({ clock });
        return { actor: made.actor, clock, made };
      },
    },
  });
  return root;
}

const clickEdge = (root: HTMLElement, id: string) =>
  root
    .querySelector(`g[data-edge-id="${id}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

function sendOnEdge(root: HTMLElement, id: string) {
  clickEdge(root, id);
  root.querySelector<HTMLButtonElement>("[data-payload-send]")?.click();
}

function addThree(root: HTMLElement) {
  sendOnEdge(root, "showingEmptyQueue-photoAdded-showingQueue");
  sendOnEdge(root, "showingQueue-photoAdded-stay");
  sendOnEdge(root, "showingQueue-photoAdded-stay");
}

const markers = (root: HTMLElement) => [...root.querySelectorAll("g.child-marker")];

describe("the docs photo queue on the live page", () => {
  test("three clicks on photoAdded start p1, p2, p3", async () => {
    const root = await mounted();
    addThree(root);
    expect(markers(root).map((each) => each.getAttribute("data-marker-key"))).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect(markers(root).map((each) => each.getAttribute("data-marker-state"))).toEqual([
      "photos.sendingPhoto",
      "photos.sendingPhoto",
      "photos.sendingPhoto",
    ]);
  });

  test("uploadConfirmed goes to p1", async () => {
    const root = await mounted();
    addThree(root);
    sendOnEdge(root, "photos.sendingPhoto-uploadConfirmed-photoSent");
    const p1 = root.querySelector('g.child-marker[data-marker-key="p1"]');
    expect(p1?.getAttribute("data-marker-state")).toBe("photos.photoSent");
    expect(root.querySelector("[data-live-outcome]")?.textContent).toBe(
      "uploadConfirmed: p1 sendingPhoto → photoSent",
    );
  });

  test("queueCleared names every removed child", async () => {
    const root = await mounted();
    addThree(root);
    sendOnEdge(root, "showingQueue-queueCleared-showingEmptyQueue");
    expect(root.querySelector("[data-live-removed]")?.textContent).toBe("p1, p2, p3 removed");
    expect(markers(root)).toEqual([]);
  });
});
