import { getBlogPosts } from "@growth-engine/sdk-server";
import { getDb, safeQuery } from "./db";

// Ready for a future blog page. The static landing page does not query the CMS.
export async function getPosts(locale: string) {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) return [];
  return safeQuery([], () => getBlogPosts(getDb(), { locale }));
}
