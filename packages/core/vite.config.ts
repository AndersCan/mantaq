import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      internal: "src/internal-registry.ts",
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
