// System fonts only (SF on macOS, matches the real Freddai app). No webfont loading.
export const FONT_DISPLAY = `-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, "Helvetica Neue", Arial, sans-serif`;
export const FONT_BODY = `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Helvetica Neue", Arial, sans-serif`;
export const FONT_MONO = `ui-monospace, "SF Mono", Menlo, monospace`;
export const fontsReady = Promise.resolve();
