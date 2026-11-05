import { mantaqViz } from "./vite.ts";
import { UPDATE_EVENT, parseViz } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

let server: ViteDevServer;
let origin = "";

beforeAll(async () => {
  server = await createServer({
    root: join(import.meta.dirname, "fixtures"),
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
    plugins: [mantaqViz({ machines: ["retry.ts", "credit.ts"], fuzz: { iterations: 100 } })],
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

describe("mantaqViz", () => {
  test("serves the live page with the Vite client and the viewer entry", async () => {
    const page = await (await fetch(`${origin}/__mantaq/`)).text();
    expect(page).toContain('<main id="app" data-src="/__mantaq/viz.json">');
    expect(page).toContain("/@vite/client");
    expect(page).toContain("<style>");
    const entry = page.match(/src="(\/@fs[^"]+live-entry\.ts)"/)?.[1];
    expect((await fetch(`${origin}${entry ?? ""}`)).status).toBe(200);
  });

  test("serves the document of every matched file", async () => {
    const text = await (await fetch(`${origin}/__mantaq/viz.json`)).text();
    const machines = Either.getRight(parseViz(text))?.machines ?? [];
    expect(machines.map((machine) => [machine.id, machine.initial])).toEqual([
      ["credit", "idle"],
      ["retry", "idle"],
    ]);
  });

  test("a file change tells the page to redraw", async () => {
    const sent: unknown[] = [];
    const send = server.ws.send.bind(server.ws);
    server.ws.send = (payload: unknown) => sent.push(payload);
    server.watcher.emit("all", "change", join(import.meta.dirname, "fixtures", "retry.ts"));
    server.ws.send = send;
    expect(sent).toEqual([{ type: "custom", event: UPDATE_EVENT }]);
  });

  test("a recorded runs file change tells the page to redraw", async () => {
    const sent: unknown[] = [];
    const send = server.ws.send.bind(server.ws);
    server.ws.send = (payload: unknown) => sent.push(payload);
    server.watcher.emit(
      "all",
      "change",
      join(import.meta.dirname, "fixtures", "__runs__", "x.test.json"),
    );
    server.ws.send = send;
    expect(sent).toEqual([{ type: "custom", event: UPDATE_EVENT }]);
  });

  test("an unrelated json change sends nothing", async () => {
    const sent: unknown[] = [];
    const send = server.ws.send.bind(server.ws);
    server.ws.send = (payload: unknown) => sent.push(payload);
    server.watcher.emit("all", "change", join(import.meta.dirname, "fixtures", "data.json"));
    server.ws.send = send;
    expect(sent).toEqual([]);
  });

  test("other paths fall through to Vite", async () => {
    expect((await fetch(`${origin}/__mantaq/nope`)).status).toBe(404);
  });
});

describe("mantaqViz targets", () => {
  test("the virtual module exposes a factory per machine with a call shape", async () => {
    const result = await server.ssrLoadModule("virtual:mantaq/targets");
    const targets: Record<string, () => { actor: { state: { name: string } }; clock: unknown }> =
      result["targets"];
    expect(Object.keys(targets).sort()).toEqual(["credit", "retry"]);
    const made = targets["retry"]?.();
    expect(made?.actor.state.name).toBe("idle");
    expect(made?.clock).toBeDefined();
  });
});
