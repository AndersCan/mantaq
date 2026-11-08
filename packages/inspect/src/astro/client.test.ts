// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const mountDriven = vi.hoisted(() => vi.fn());
vi.mock("../live-page.ts", () => ({ mountDriven }));
vi.mock("@mantaq/viz/viewer.css", () => ({}));

function machineRoot(data: Record<string, string>): void {
  const root = document.createElement("div");
  root.className = "mantaq-machine";
  for (const [key, value] of Object.entries(data)) root.dataset[key] = value;
  document.body.append(root);
}

describe("astro client", () => {
  beforeEach(() => {
    vi.resetModules();
    mountDriven.mockClear();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("passes data-mantaq-routes to the viewer", async () => {
    const routes = { m: { openAlbum: [{ to: "router", event: "NAVIGATED", at: "a.ts:1" }] } };
    machineRoot({ mantaqViz: "{}", mantaqRoutes: JSON.stringify(routes) });
    await import("./client.ts");
    expect(mountDriven).toHaveBeenCalledTimes(1);
    expect(mountDriven.mock.calls[0]?.[1]).toMatchObject({ routes, text: "{}", heading: "h2" });
  });

  test("without data-mantaq-routes the viewer gets no routes", async () => {
    machineRoot({ mantaqViz: "{}" });
    await import("./client.ts");
    expect(mountDriven).toHaveBeenCalledTimes(1);
    expect(mountDriven.mock.calls[0]?.[1]).not.toHaveProperty("routes");
  });
});
