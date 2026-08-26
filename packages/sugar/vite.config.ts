import { defineConfig } from "vite-plus";

// oxlint-disable-next-line oxlinter/named-exports-only -- framework-mandated default export for vite config
export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
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
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
  fmt: {},
});
