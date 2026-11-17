import { mantaqViz, targetsSource } from "./vite.ts";
import { UPDATE_EVENT, parseViz } from "@mantaq/viz";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { createLogger, createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

let server: ViteDevServer;
let origin = "";

beforeAll(async () => {
  server = await createServer({
    root: join(import.meta.dirname, "fixtures"),
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", watch: { ignored: ["**/*"] } },
    plugins: [
      mantaqViz({
        machines: ["retry.ts", "credit.ts", "previewed.ts", "previewed.preview.ts"],
        fuzz: { iterations: 100 },
      }),
    ],
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
      ["door", "closed"],
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
    expect(Object.keys(targets).sort()).toEqual(["credit", "door", "retry"]);
    const made = targets["retry"]?.();
    expect(made?.actor.state.name).toBe("idle");
    expect(made?.clock).toBeDefined();
  });
});

describe("mantaqViz previews", () => {
  test("only machines with a sibling preview file are previewed", async () => {
    const result = await server.ssrLoadModule("virtual:mantaq/targets");
    expect(result["previewed"]).toEqual(["door"]);
  });

  test("the previews module imports the preview file", async () => {
    const result = await server.ssrLoadModule("virtual:mantaq/previews");
    const previews: Record<
      string,
      () => Promise<{ default: (e: HTMLElement, s: unknown) => void }>
    > = result["previews"];
    expect(Object.keys(previews)).toEqual(["door"]);
    const element: { textContent: string } = { textContent: "" };
    (await previews["door"]?.())?.default(element as HTMLElement, { name: "open" });
    expect(element.textContent).toBe("door is open");
  });

  test("the frame page loads the entry through Vite", async () => {
    const response = await fetch(`${origin}/__mantaq/preview?machine=door`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("/@vite/client");
    expect(html).toContain("preview-entry");
    expect(html).toMatch(/<body[^>]*\sinert/);
  });

  test("a preview file is not inspected as a machine", async () => {
    const response = await fetch(`${origin}/__mantaq/viz.json`);
    const viz = parseViz(await response.text());
    const ids = Either.isRight(viz) ? viz[1].machines.map((m) => m.id).sort() : [];
    expect(ids).toEqual(["credit", "door", "retry"]);
  });
});

describe("mantaqViz fuzz budget", () => {
  async function served(fuzz?: { iterations: number }) {
    const logged: string[] = [];
    const logger = createLogger("silent");
    logger.warn = (message) => void logged.push(message);
    const dev = await createServer({
      root: join(import.meta.dirname, "fixtures"),
      configFile: false,
      customLogger: logger,
      server: { port: 0, host: "127.0.0.1", watch: { ignored: ["**/*"] } },
      plugins: [mantaqViz({ machines: ["checkout.ts"], ...(fuzz === undefined ? {} : { fuzz }) })],
    });
    await dev.listen();
    const address = dev.httpServer?.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const text = await (await fetch(`http://127.0.0.1:${port}/__mantaq/viz.json`)).text();
    await dev.close();
    return { machine: Either.getRight(parseViz(text))?.machines[0], logged };
  }

  test("the dev default is a time budget that ends at full coverage", async () => {
    const { machine, logged } = await served();
    expect(logged.filter((line) => line.includes("fuzz never reached"))).toEqual([]);
    expect(machine?.fuzz?.iterations).toBeLessThan(2000);
    expect(machine?.states.every((state) => (state.coverage?.hits ?? 0) > 0)).toBe(true);
  });

  test("what fuzz missed is logged with the iterations run", async () => {
    const { logged } = await served({ iterations: 1 });
    expect(logged.find((line) => line.includes("fuzz never reached"))).toMatch(
      /^\[mantaq-viz\] checkout: fuzz never reached: .*\(ran 1 iterations, stopped: iteration cap\)/,
    );
  });
});

describe("targetsSource: machine(...) exports", () => {
  const source = targetsSource([join(import.meta.dirname, "fixtures/machine-values.ts")]);

  test("each is keyed by its id and built on a clock the page owns", () => {
    expect(source).toContain(
      '"deadline": () => { const clock = VirtualClock(); const made = m0["deadline"].create({ clock });',
    );
    expect(source).toContain(
      '"sleeper": () => { const clock = VirtualClock(); const made = m0["sleeper"].create({ clock });',
    );
    expect(source).toContain("return { actor, clock, made }");
  });

  test("a legacy factory next to a machine is not a target", () => {
    const mixed = targetsSource([join(import.meta.dirname, "fixtures/machine-and-factory.ts")]);
    expect(mixed).toContain('"solo"');
    expect(mixed).not.toContain("createLegacyActor");
    expect(mixed).not.toContain('"legacy"');
  });
});
