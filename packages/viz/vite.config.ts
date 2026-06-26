import { defineConfig } from "vite-plus";
import UnoCSS from "unocss/vite";
import { playwright } from "vite-plus/test/browser-playwright";

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
    browser: {
      enabled: true,
      provider: playwright(),
      headless: false,
      instances: [{ browser: "chromium" }],
    },
  },
} as any);
