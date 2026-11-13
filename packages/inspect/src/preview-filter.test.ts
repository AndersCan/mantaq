// Place in packages/inspect/src/vite.test.ts (or as its own file in packages/inspect/src).
// Fails when the `.preview.ts` filter in machineFiles is removed:
// the dev server then SSR-loads the preview file and warns "no exported actor or actor factory found".
import { mantaqViz } from "./vite.ts";
import { join } from "node:path";
import { createLogger, createServer } from "vite";
import { expect, test } from "vite-plus/test";

test("a broad glob neither loads nor warns about a preview file", async () => {
  const logged: string[] = [];
  const logger = createLogger("silent");
  logger.warn = (message) => void logged.push(message);
  const dev = await createServer({
    root: join(import.meta.dirname, "fixtures"),
    configFile: false,
    customLogger: logger,
    server: { port: 0, host: "127.0.0.1", watch: { ignored: ["**/*"] } },
    plugins: [mantaqViz({ machines: ["previewed*.ts"], fuzz: { iterations: 10 } })],
  });
  await dev.listen();
  const address = dev.httpServer?.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await (await fetch(`http://127.0.0.1:${port}/__mantaq/viz.json`)).text();
  const loaded = [...dev.environments.ssr.moduleGraph.idToModuleMap.keys()];
  await dev.close();
  expect(logged.filter((line) => line.includes("preview"))).toEqual([]);
  expect(loaded.filter((id) => id.endsWith("previewed.preview.ts"))).toEqual([]);
});
