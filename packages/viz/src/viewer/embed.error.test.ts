// @vitest-environment happy-dom
import { mountVizText } from "./embed.ts";
import { describe, expect, test } from "vite-plus/test";

describe("mountVizText: bad input", () => {
  test("lists the issues instead of drawing", () => {
    const root = document.createElement("div");
    mountVizText(root, { source: "bad.json", text: '{"schemaVersion": 1, "machines": []}' });
    expect(root.querySelector(".load-error h2")?.textContent).toBe("Cannot show bad.json");
    expect(root.querySelectorAll(".load-error li").length).toBeGreaterThan(0);
  });
});
