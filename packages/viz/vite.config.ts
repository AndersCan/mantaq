import { defineConfig } from "vite-plus";
import UnoCSS from "unocss/vite";

const unoPlugin = UnoCSS({ mode: "shadow-dom" });

export default defineConfig({
  plugins: [unoPlugin],
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
  fmt: {},
  test: {
    environment: "jsdom",
  },
});
