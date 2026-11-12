// Brand palette. Replace every value with the product's real colors (pull them from its landing page / CSS).
// Keep the KEYS: the shared components (text.tsx, fx.tsx) import C.white, C.indigo, C.slateLight, GRAD, clamp.
export const C = {
  // dark UI scenes
  bgDark: "#1e241e",
  bgDark2: "#282f26",
  line: "#404a3b",
  textDark: "#f0f1e7",
  sage: "#b9c99a", // dark primary
  // light paper scenes
  cream: "#faf9f5",
  cream2: "#eeefe6",
  paper: "#faf9f5",
  edge: "#dadccf",
  ink: "#282d23",
  forest: "#4d613d", // light primary
  green: "#4d613d",
  green2: "#4d613d",
  mint: "#b9c99a",
  mintSoft: "#b9c99a",
  mintPale: "#eeefe6",
  amber: "#c7893c",
  amberSoft: "#e9ac42",
  slate: "#5f6857",
  slateLight: "#98a08c",
  white: "#FFFFFF",
  red: "#e5484d",
  indigo: "#b9c99a", // shared accent slot (Kicker/Typewriter cursor): sage
  navy: "#1e241e",
  fur: "#D3A16B", // dormouse
};
export const FONT = "system-ui, -apple-system, 'SF Pro Text', sans-serif";
export const GRAD = "linear-gradient(90deg, #4d613d 0%, #b9c99a 100%)";
export const GRAD_INDIGO = "linear-gradient(135deg, #4d613d 0%, #282f26 100%)";
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
