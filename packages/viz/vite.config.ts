import { defineConfig, defaultExclude } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
    entry: {
      // keys are output names: `index` → export ".", `core` → export "./core"
      index: "src/index.ts",
      core: "src/core/index.ts",
    },
    css: {
      // all CSS merges into one dist/styles.css (tsdown default: splitting
      // false, @import inlining on) — the consumer adds one import line:
      // `import "@mantaq/viz/styles.css"`.
      fileName: "styles.css",
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    passWithNoTests: true,
    exclude: [...defaultExclude, "browser/**"],
    coverage: {
      reporter: ["text", "text-summary"],
      thresholds: {
        statements: 60,
        branches: 40,
        functions: 60,
        lines: 60,
      },
    },
  },
  fmt: {},
});
