import { defineConfig } from "vite-plus";

// oxlint-disable-next-line oxlinter/named-exports-only -- framework-mandated default export for vite config
export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
    },
    dts: {
      tsgo: true,
    },
    exports: true,
    minify: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    coverage: {
      reporter: ["text", "text-summary"],
      thresholds: {
        statements: 85,
        branches: 82,
        functions: 75,
        lines: 88,
      },
    },
  },
  fmt: {},
});
