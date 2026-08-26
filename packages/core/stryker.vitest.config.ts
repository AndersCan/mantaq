import { defineConfig } from "vite-plus";

// oxlint-disable-next-line oxlinter/named-exports-only -- framework-mandated default export for stryker config
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "../examples/*.test.ts"],
    exclude: ["src/showcase/**"],
    cache: false,
  },
});
