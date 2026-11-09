import { defineEcConfig } from "@astrojs/starlight/expressive-code";

export default defineEcConfig({
  // Highlighted and added lines are pink; deleted lines keep the default.
  styleOverrides: {
    textMarkers: {
      markBackground: "color-mix(in srgb, var(--mq-pink) 18%, transparent)",
      markBorderColor: "var(--mq-pink)",
      insBackground: "color-mix(in srgb, var(--mq-pink) 12%, transparent)",
      insBorderColor: "var(--mq-pink)",
      insDiffIndicatorColor: "var(--mq-pink)",
    },
  },
});
