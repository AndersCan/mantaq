// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { createCheckoutActor } from "./fixtures/checkout.ts";
import { inspectModule, vizDocument } from "./index.ts";
import { mountDriven } from "./live-page.ts";
import { serializeViz } from "@mantaq/viz";

const file = join(import.meta.dirname, "fixtures", "checkout.ts");

async function documentText(): Promise<string> {
  const inspected = await inspectModule(file, {
    load: async () => ({ createCheckoutActor }),
    fuzz: false,
  });
  return serializeViz(vizDocument(inspected.machines));
}

describe("mountDriven", () => {
  test("mounts the viewer with a live driver for a machine that has a target", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const create = () => {
      const clock = VirtualClock();
      return { actor: createCheckoutActor(clock), clock };
    };
    mountDriven(root, {
      source: "test",
      text: await documentText(),
      targets: { checkout: create },
    });
    expect(root.textContent).toContain("Live");
  });

  test("without a target the viewer is the static walk", async () => {
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: await documentText(), targets: {} });
    expect(root.textContent).not.toContain("Live: the real machine");
  });

  test("an invalid document lists its issues", () => {
    const root = document.createElement("div");
    mountDriven(root, { source: "test", text: "{}", targets: {} });
    expect(root.textContent).toContain("Cannot show test");
  });
});
