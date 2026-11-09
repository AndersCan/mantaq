import { defineConfig } from "vite-plus";

// oxlint-disable-next-line oxlinter/named-exports-only -- framework-mandated default export for vite config
export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  // Every test builds a full TypeScript program; the first also loads the lib and core types cold.
  test: { testTimeout: 30_000 },
  fmt: {},
});
