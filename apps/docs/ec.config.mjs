import { defineEcConfig } from "@astrojs/starlight/expressive-code";

export default defineEcConfig({
  // Highlighted and added lines are pink; deleted lines keep the default.
  styleOverrides: {
    textMarkers: {
      insBackground: "color-mix(in srgb, var(--mq-pink) 12%, transparent)",
      insBorderColor: "var(--mq-pink)",
      insDiffIndicatorColor: "var(--mq-pink)",
    },
  },
  // Starlight writes its own mark colours into each theme, so set ours after it.
  // Light themes use a 12% wash to keep text at 4.5:1 contrast.
  customizeTheme: (theme) => {
    const wash = theme.type === "light" ? 12 : 18;
    theme.styleOverrides.textMarkers = {
      ...theme.styleOverrides.textMarkers,
      markBackground: `color-mix(in srgb, var(--mq-pink) ${wash}%, transparent)`,
      markBorderColor: "var(--mq-pink)",
    };
    return theme;
  },
});
