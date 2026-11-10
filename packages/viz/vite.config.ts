import { defineConfig } from "vite-plus";

// oxlint-disable-next-line oxlinter/named-exports-only -- framework-mandated default export for vite config
export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      viewer: "src/viewer/embed.ts",
      page: "src/viewer/page.ts",
      live: "src/viewer/live.ts",
    },
    dts: {
      generator: "tsgo",
    },
    exports: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
