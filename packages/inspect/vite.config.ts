import { defineConfig } from "vite-plus";

// oxlint-disable-next-line oxlinter/named-exports-only -- framework-mandated default export for vite config
export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      vite: "src/vite.ts",
      astro: "src/astro.ts",
      "astro-client": "src/astro/client.ts",
      record: "src/record.ts",
      drive: "src/drive.ts",
      "live-entry": "src/live-entry.ts",
    },
    dts: {
      generator: "tsgo",
    },
    exports: {
      devExports: true,
      // Shipped as source: Astro compiles it in the user's site.
      customExports: (exports) => ({
        ...exports,
        "./astro/Machine.astro": "./src/astro/Machine.astro",
        "./astro/Machines.astro": "./src/astro/Machines.astro",
      }),
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
