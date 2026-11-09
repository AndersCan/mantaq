import { defineEcConfig, ExpressiveCodeTheme } from "@astrojs/starlight/expressive-code";

/** @param {"dark" | "light"} type */
function mono(type) {
  const dark = type === "dark";
  const fg = dark ? "#ffffff" : "#000000";
  const bg = dark ? "#000000" : "#ffffff";
  const comment = dark ? "#9a9aa3" : "#6b6b70";
  const literal = dark ? "#d0d0d0" : "#3a3a3a";
  return new ExpressiveCodeTheme({
    name: `mantaq-${type}`,
    type,
    colors: { "editor.background": bg, "editor.foreground": fg },
    settings: [],
    tokenColors: [
      { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: comment } },
      {
        scope: ["string", "constant.numeric", "constant.language"],
        settings: { foreground: literal },
      },
      { scope: [], settings: { foreground: fg } },
    ],
  });
}

export default defineEcConfig({
  themes: [mono("dark"), mono("light")],
  useStarlightUiThemeColors: true,
  // Added lines read as a grey wash with the `+` gutter glyph, not green.
  styleOverrides: {
    textMarkers: {
      insBackground: "color-mix(in srgb, currentColor 14%, transparent)",
      insBorderColor: "currentColor",
      insDiffIndicatorColor: "currentColor",
    },
  },
});
