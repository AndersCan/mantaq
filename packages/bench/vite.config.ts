import { defineConfig } from "vite-plus";

// oxlint-disable-next-line oxlinter/named-exports-only -- framework-mandated default export for vite config
export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    benchmark: { include: ["src/**/*.bench.ts"] },
    // benchmarks must not compete for CPU
    fileParallelism: false,
    execArgv: ["--expose-gc", "--max-semi-space-size=128"],
  },
  fmt: {},
});
