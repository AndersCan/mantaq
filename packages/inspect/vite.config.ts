import { defineConfig } from "vite-plus";

// oxlint-disable-next-line oxlinter/named-exports-only -- framework-mandated default export for vite config
export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      vite: "src/vite.ts",
      record: "src/record.ts",
      drive: "src/drive.ts",
      "live-entry": "src/live-entry.ts",
    },
    dts: {
      generator: "tsgo",
    },
    exports: { devExports: true },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
