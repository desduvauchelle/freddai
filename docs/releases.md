# Desktop releases

Source repository: https://github.com/desduvauchelle/freddai (public). Production website: https://freddai.ai-juicing.com, hosted by the `freddai` Vercel project in the personal `desduvauchelles-projects` Hobby account. Vercel builds `apps/web` from `main`, includes workspace dependencies outside that directory, and uses Node 24. The Squarespace `freddai` CNAME points to `7ae8c160439a60c5.vercel-dns-017.com`.

`RELEASES_REPOSITORY=desduvauchelle/freddai` connects published release assets to the website. `SITE_URL=https://freddai.ai-juicing.com` is configured for production. No public desktop release exists yet; downloads remain unavailable until a verified installer is published.

## Initial setup

1. The repository and Vercel Git connection are configured. `.gitignore` excludes build outputs, local caches, previews, environment files and signing material. Keep both lockfiles committed.
2. Configure Actions repository secrets: `APPLE_CERTIFICATE` (base64 Developer ID Application certificate exported as a password-protected .p12, including its private key), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (full Developer ID Application name), `APPLE_ID`, `APPLE_PASSWORD` (Apple app-specific password), and `APPLE_TEAM_ID`. The existing Developer ID was exported with a generated password and uploaded directly to this repository at the owner’s request. The certificate, export password, signing identity, team ID and Apple ID secrets are configured; `APPLE_PASSWORD` still requires an Apple app-specific password. Temporary signing exports are not retained.
3. Run **Package desktop** manually to validate builds. This uploads workflow artifacts without creating a release. macOS credentials are required even for manual runs; unsigned distribution builds are not silently substituted.
4. Set the deployed Next.js server's `RELEASES_REPOSITORY=owner/repo` to a public distribution repository. `MACOS_DOWNLOAD_URL` remains an optional HTTPS override. No token is required or sent to visitors.

The workflow creates drafts in the source repository using its built-in `GITHUB_TOKEN`. If source is private, copy the final installers into a release in a separate public distribution repository before publishing; automatic cross-repository publishing is not configured. Set the website repository to that public repository.

## Release a version

Update `apps/native/src-tauri/tauri.conf.json`, both Rust package versions, and workspace/native package versions together; refresh the lockfiles. Commit, then push a matching tag such as `v0.1.0`. The workflow rejects a tag that differs from the Tauri version.

macOS builds one signed and notarized universal DMG for Apple Silicon and Intel. Linux builds x64 Debian and AppImage packages. Builds and tests must all succeed before a draft is created. Reruns may replace draft assets but refuse to change published releases. Packaging arguments override local app-only bundling; `pnpm native:install` keeps its existing behavior.

Download the draft installers and verify clean installation, launch, provider discovery and normal application behavior on each claimed platform. Review release notes, then publish the draft as the latest stable release. Publishing is deliberately manual. The website reads GitHub's latest stable release metadata with five-minute revalidation and offers the exact `Freddai-macos-universal.dmg` asset. Drafts, prereleases, missing assets, invalid repository settings and API failures show the existing coming-soon state. Initial configuration requires a website deployment; subsequent published releases require no website rebuild. Run Next.js as a server, not a static export.

Linux downloads are retained as release assets pending runtime verification and website UI support. Windows is validation-only: use the manual workflow's enabled-by-default checkbox to attempt an unsigned NSIS build. The background host currently rejects non-Unix platforms, so Windows artifacts are never included in release drafts or advertised as supported. CI success alone is not platform runtime verification. Automatic in-app updates remain outside this workflow. Vercel handles web deployment independently on pushes to `main`. Changes to the packaging workflow also trigger installer validation. The separate Checks workflow runs typechecking, web/native frontend builds, web/relay tests and core Rust tests on pushes and pull requests.

## Local checks

- `node --test apps/web/tests/download.test.mjs` (Node 24+)
- `pnpm typecheck`
- `pnpm --filter @freddai/web build`
- `pnpm native:install` for required local macOS delivery

The first GitHub run is still required to verify hosted runners, certificate import, notarization, universal compilation and Linux packaging.
