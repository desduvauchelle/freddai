import { getClientDb } from '@growth-engine/sdk-server'

export function getDb() {
	const url = process.env.TURSO_DATABASE_URL
	const token = process.env.TURSO_AUTH_TOKEN
	if (!url || !token) {
		throw new Error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
	}
	return getClientDb(url, token)
}

/**
 * Run a content read, returning `fallback` when the database is missing or
 * unreachable instead of crashing the page. A marketing site must keep
 * rendering (with empty content) through CMS/database hiccups : the error is
 * logged loudly for operators, never shown as a 500 to visitors.
 *
 * Call `getDb()` INSIDE the closure so missing env vars are caught too:
 *   const posts = await safeQuery([], () => getBlogPosts(getDb(), { locale }))
 */
export async function safeQuery<T>(fallback: T, query: () => Promise<T>): Promise<T> {
	try {
		return await query()
	} catch (err) {
		console.error('[GrowthEngine] content query failed : rendering fallback:', err)
		return fallback
	}
}
