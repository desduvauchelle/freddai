export const defaultLocale: string = process.env.DEFAULT_LANGUAGE ?? 'en'

export const additionalLocales: string[] =
	process.env.ADDITIONAL_LANGUAGES
		? process.env.ADDITIONAL_LANGUAGES.split(',').map((l) => l.trim()).filter(Boolean)
		: []

export const supportedLocales: string[] = [defaultLocale, ...additionalLocales]

export const isMultiLang: boolean = additionalLocales.length > 0

/**
 * Is `locale` a real, configured locale (and therefore allowed to resolve a
 * page)? The `[locale]` route segment matches ANY first path segment, so this
 * is the gate that stops bogus segments : `/rss.xml/legal`, `/index.iml/...`
 * from bot probes or stale links : from rendering a real page (HTTP 200) with
 * a self-referencing canonical to the garbage URL. Used by `[locale]/layout.tsx`
 * to `notFound()` everything that isn't a locale. Kept pure (no `next/*` import)
 * so it is unit-testable on its own.
 */
export function isSupportedLocale(locale: string): boolean {
	return supportedLocales.includes(locale)
}
