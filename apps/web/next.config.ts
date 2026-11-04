import type { NextConfig } from "next";
import { securityHeaders } from "@growth-engine/sdk-server/security-headers";

const config: NextConfig = {
  // Keep proxy rewrite hosts intact, including 127.0.0.1 in local production.
  skipProxyUrlNormalize: true,
  serverExternalPackages: ["@growth-engine/sdk-server", "@libsql/client", "libsql", "drizzle-orm"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};
export default config;
