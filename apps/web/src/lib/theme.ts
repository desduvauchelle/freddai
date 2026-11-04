// Theme preference model.
//
// Three user-facing choices : `light`, `dark`, `auto` : where `auto` follows the
// OS via `prefers-color-scheme`. `auto` is the default: until the visitor picks
// something explicitly, the site matches their system setting. Once they click,
// the stored choice wins on every visit until they switch back to `auto`.
//
// DaisyUI renders from the `data-theme` attribute on `<html>`, so the resolved
// theme (never `auto`) is what gets written there.

export type ThemePreference = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'theme'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'auto'
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'auto']
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === 'light' || value === 'dark' || value === 'auto'
}

/** Collapse a preference plus the current OS setting into the value for `data-theme`. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
	if (preference === 'auto') {
		return prefersDark ? 'dark' : 'light'
	}
	return preference
}

// Inline, render-blocking script injected in the root layout's <head>. It sets
// `data-theme` before the first paint so a dark-preference visitor never sees a
// white flash. Anything stored that isn't an explicit 'light'/'dark' (including
// 'auto' and a missing key) falls through to the OS query.
//
// This must stay dependency-free ES5 : it runs before any bundle loads.
export const THEME_INIT_SCRIPT = `(function(){try{var p=window.localStorage.getItem('${THEME_STORAGE_KEY}');if(p!=='light'&&p!=='dark'){p=window.matchMedia('${DARK_MEDIA_QUERY}').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',p)}catch(e){}})()`
