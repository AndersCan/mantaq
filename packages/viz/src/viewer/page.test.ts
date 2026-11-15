// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { linkOptions } from "./page.ts";

describe("the address bar", () => {
  test("opens on the values in the address and writes them back with the walk", () => {
    history.replaceState(null, "", "?machine=answer&step=ask&value=code%3D%22c1%22&value=n%3D2");
    const options = linkOptions();
    expect(options.values).toEqual(['code="c1"', "n=2"]);
    options.onNavigate?.({
      machine: "answer",
      steps: ["ask", "answered"],
      values: ['code="c2"'],
    });
    const params = new URLSearchParams(location.search);
    expect(params.getAll("value")).toEqual(['code="c2"']);
    expect(params.getAll("step")).toEqual(["ask", "answered"]);
  });

  test("clearing the last value removes it from the address", () => {
    history.replaceState(null, "", "?machine=answer&value=n%3D2");
    linkOptions().onNavigate?.({ machine: "answer", steps: [], values: [] });
    expect(new URLSearchParams(location.search).has("value")).toBe(false);
  });
});
