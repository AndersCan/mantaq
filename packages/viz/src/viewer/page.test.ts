// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { linkOptions } from "./page.ts";

describe("the address bar", () => {
  test("opens on the payloads in the address and writes them back with the walk", () => {
    history.replaceState(
      undefined,
      "",
      "?machine=answer&step=ask&payload=ask%3D%7B%22code%22%3A%22c1%22%7D",
    );
    const options = linkOptions();
    expect(options.payloads).toEqual(['ask={"code":"c1"}']);
    options.onNavigate?.({
      machine: "answer",
      steps: ["ask", "answered"],
      payloads: ['ask={"code":"c2"}'],
    });
    const params = new URLSearchParams(location.search);
    expect(params.getAll("payload")).toEqual(['ask={"code":"c2"}']);
    expect(params.getAll("step")).toEqual(["ask", "answered"]);
  });

  test("an old link's values are read, and the next walk writes them as payloads", () => {
    history.replaceState(undefined, "", "?machine=answer&value=code%3D%22c1%22&value=n%3D2");
    const options = linkOptions();
    expect(options.values).toEqual(['code="c1"', "n=2"]);
    options.onNavigate?.({ machine: "answer", steps: [], payloads: ['ask={"code":"c1"}'] });
    const params = new URLSearchParams(location.search);
    expect([params.has("value"), params.getAll("payload")]).toEqual([false, ['ask={"code":"c1"}']]);
  });

  test("clearing the last payload removes it from the address", () => {
    history.replaceState(undefined, "", "?machine=answer&payload=ask%3D%7B%7D");
    linkOptions().onNavigate?.({ machine: "answer", steps: [], payloads: [] });
    expect(new URLSearchParams(location.search).has("payload")).toBe(false);
  });
});
