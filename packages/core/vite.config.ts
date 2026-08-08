import { defineConfig } from "vite-plus";

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
        statements: 85,
        branches: 82,
        functions: 75,
        lines: 88,
      },
    },
  },
  fmt: {},
});
