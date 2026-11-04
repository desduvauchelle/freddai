import { defaultLocale } from '@/i18n/config'

export function formatDate(date: Date | string, locale: string = 'en'): string {
	return new Date(date).toLocaleDateString(locale, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	})
}

/**
 * The URL prefix for a locale. The default language lives at the site root and
 * carries NO prefix (`''`); every other language is prefixed (`/fr`, `/de`, …).
 *
 * This is the single source of truth for "does this locale show up in the URL".
 * `localizedPath`, the `<link rel="canonical">` tags, the sitemap (`buildUrl`),
 * and the middleware redirect all derive their behaviour from this rule, so the
 * default language never carries a locale segment anywhere.
 */
export function localePrefix(locale: string): string {
	return locale === defaultLocale ? '' : `/${locale}`
}

/**
 * Build an internal href for a path in a given locale.
 *
 *   localizedPath('/', 'en')        -> '/'
 *   localizedPath('/', 'fr')        -> '/fr'
 *   localizedPath('/blog', 'en')    -> '/blog'
 *   localizedPath('/blog/x', 'fr')  -> '/fr/blog/x'
 *
 * ALWAYS use this for links between pages. Never hand-write `/${locale}/...` :
 * that re-introduces a locale segment on the default language and splits the
 * canonical signal (see template CLAUDE.md "Links between pages").
 */
export function localizedPath(path: string, locale: string): string {
	const prefix = localePrefix(locale)
	if (path === '' || path === '/') return prefix || '/'
	const normalized = path.startsWith('/') ? path : `/${path}`
	return `${prefix}${normalized}`
}

/**
 * If `pathname` carries the DEFAULT locale as its first segment, return the
 * bare path it should permanently redirect to (so `/en/blog` → `/blog`,
 * `/en` → `/`). Returns `null` when no redirect is needed (bare path, or a
 * secondary locale that legitimately keeps its prefix).
 *
 * Used by the middleware to collapse the default-locale duplicate. Kept pure
 * (no `next/*` imports) so it is unit-testable on its own.
 */
export function defaultLocaleRedirectTarget(
	pathname: string,
	defaultLoc: string = defaultLocale,
): string | null {
	const firstSegment = pathname.split('/')[1] ?? ''
	if (firstSegment !== defaultLoc) return null
	return pathname.slice(`/${defaultLoc}`.length) || '/'
}
