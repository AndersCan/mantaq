import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "../examples/*.actor.test.ts"],
    exclude: ["tests/showcase/**"],
  },
});
