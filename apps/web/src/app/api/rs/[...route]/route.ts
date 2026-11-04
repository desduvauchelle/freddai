import { GrowthEngineHandler } from "@growth-engine/sdk-server";

export const runtime = "nodejs";

export const { GET, POST } = GrowthEngineHandler({
  brainApiUrl: process.env.BRAIN_API_URL,
  brainApiKey: process.env.BRAIN_API_KEY,
  tursoUrl: process.env.TURSO_DATABASE_URL,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
  structuralLinks: false,
  securityHeaders: true,
});
