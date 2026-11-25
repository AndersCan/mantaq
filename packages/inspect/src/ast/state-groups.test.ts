import { describe, expect, test } from "vite-plus/test";
import type { VizMachine, VizState } from "@mantaq/viz";
import { astroMachines } from "../astro.ts";
import { createServer } from "vite";
import { Either } from "@mantaq/utils";
import { grouped } from "../fixtures/grouped.ts";
import { inspect } from "../inspect.ts";
import { join } from "node:path";
import { mantaqViz } from "../vite.ts";
import { parseViz } from "@mantaq/viz";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const FILE = join(FIXTURES, "grouped.ts");
const DOCUMENTS = "\0virtual:mantaq/documents";

/** Each state of the grouped checkout as the document draws it, sorted by id. */
const EXPECTED = [
  { id: "chargingCard", group: "payment", doc: "The card is charged." },
  { id: "confirming", group: "payment", doc: "The bank asks the buyer to confirm." },
  {
    id: "inCart",
    group: undefined,
    doc: "The order waits in the cart. Mail help@group.example with questions.",
  },
  { id: "packing", group: "shipping", doc: "The parcel is packed and sent." },
  { id: "sent", group: "shipping", doc: "The parcel is packed and sent." },
];

function groupsOf(state: VizState) {
  return { id: state.id, group: state.group, doc: state.doc };
}

/** The grouped checkout of a served document; undefined when it does not validate. */
function checkoutIn(text: string): VizMachine | undefined {
  const machines = Either.getRight(parseViz(text))?.machines ?? [];
  return machines.find((machine) => machine.id === "grouped");
}

async function servedDocument(): Promise<string> {
  const server = await createServer({
    root: FIXTURES,
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", watch: { ignored: ["**/*"] } },
    plugins: [mantaqViz({ machines: ["grouped.ts"], fuzz: false })],
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const text = await (await fetch(`http://127.0.0.1:${port}/__mantaq/viz.json`)).text();
  await server.close();
  return text;
}

async function astroDocument(): Promise<string> {
  const plugin = astroMachines({ root: FIXTURES, files: [FILE], fuzz: false });
  const context = { warn: () => undefined, error: () => undefined };
  const load: unknown = Reflect.get(plugin, "load");
  const source: unknown =
    typeof load === "function" ? await Reflect.apply(load, context, [DOCUMENTS]) : "";
  const prefix = "export const documents = ";
  const line = String(source)
    .split("\n")
    .find((each) => each.startsWith(prefix));
  const documents: Record<string, { text: string }> = JSON.parse(
    (line ?? "{}").slice(prefix.length).replace(/;$/, ""),
  );
  return documents[FILE]?.text ?? "";
}

describe("@group tags on state declarations", () => {
  test("inspect() puts group on exactly the tagged states and cuts the tag from doc", () => {
    const { machine } = inspect({ machine: grouped, source: { file: FILE, root: FIXTURES } });
    expect(machine.states.map(groupsOf)).toEqual(EXPECTED);
  });

  test("the Vite page's document carries the groups and validates", async () => {
    const checkout = checkoutIn(await servedDocument());
    expect(checkout?.states.map(groupsOf)).toEqual(EXPECTED);
  }, 60_000);

  test("the Astro document carries the groups and validates", async () => {
    const checkout = checkoutIn(await astroDocument());
    expect(checkout?.states.map(groupsOf)).toEqual(EXPECTED);
  }, 60_000);
});
