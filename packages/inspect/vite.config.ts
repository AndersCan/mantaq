import { defineConfig } from "vite-plus";

// oxlint-disable-next-line oxlinter/named-exports-only -- framework-mandated default export for vite config
export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      cli: "src/cli.ts",
      vite: "src/vite.ts",
      drive: "src/drive.ts",
    },
    dts: {
      generator: "tsgo",
    },
    exports: { devExports: true, exclude: ["cli"], bin: { "mantaq-inspect": "./src/cli.ts" } },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
