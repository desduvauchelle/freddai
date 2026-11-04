// Only expose an actual release URL. No fabricated installer links or local bundles.
export function releaseDownloadUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Public release metadata only: private source repositories can use a public
// distribution repository. Never send a GitHub credential to the browser.
export function macDownloadFromRelease(value: unknown, repository: string): string | null {
  if (!value || typeof value !== "object") return null;
  const release = value as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) return null;
  for (const asset of release.assets) {
    if (!asset || typeof asset !== "object" || asset.name !== "Freddai-macos-universal.dmg" || asset.state !== "uploaded") continue;
    const url = releaseDownloadUrl(asset.browser_download_url);
    if (url && url.startsWith(`https://github.com/${repository}/releases/download/`)) return url;
  }
  return null;
}

export async function latestMacDownloadUrl(): Promise<string | null> {
  const override = releaseDownloadUrl(process.env.MACOS_DOWNLOAD_URL);
  if (override) return override;
  const repository = process.env.RELEASES_REPOSITORY;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return macDownloadFromRelease(await response.json(), repository);
  } catch { return null; }
}
