# Desktop releases

The packaging workflow is local scaffolding until this folder is committed and pushed to GitHub. No remote repository, secrets, account, or release has been created.

## Initial setup

1. Create the intended GitHub repository and push this project, including the lockfiles and `.github/workflows/package.yml`. Do not commit `.env` files or signing material.
2. Configure Actions repository secrets: `APPLE_CERTIFICATE` (base64 Developer ID Application certificate exported as a password-protected .p12, including its private key), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (full Developer ID Application name), `APPLE_ID`, `APPLE_PASSWORD` (Apple app-specific password), and `APPLE_TEAM_ID`. Export the existing identity through Keychain Access; this setup does not extract credentials automatically.
3. Run **Package desktop** manually to validate builds. This uploads workflow artifacts without creating a release. macOS credentials are required even for manual runs; unsigned distribution builds are not silently substituted.
4. Set the deployed Next.js server's `RELEASES_REPOSITORY=owner/repo` to a public distribution repository. `MACOS_DOWNLOAD_URL` remains an optional HTTPS override. No token is required or sent to visitors.

The workflow creates drafts in the source repository using its built-in `GITHUB_TOKEN`. If source is private, copy the final installers into a release in a separate public distribution repository before publishing; automatic cross-repository publishing is not configured. Set the website repository to that public repository.

## Release a version

Update `apps/native/src-tauri/tauri.conf.json`, both Rust package versions, and workspace/native package versions together; refresh the lockfiles. Commit, then push a matching tag such as `v0.1.0`. The workflow rejects a tag that differs from the Tauri version.

macOS builds one signed and notarized universal DMG for Apple Silicon and Intel. Linux builds x64 Debian and AppImage packages. Builds and tests must all succeed before a draft is created. Reruns may replace draft assets but refuse to change published releases. Packaging arguments override local app-only bundling; `pnpm native:install` keeps its existing behavior.

Download the draft installers and verify clean installation, launch, provider discovery and normal application behavior on each claimed platform. Review release notes, then publish the draft as the latest stable release. Publishing is deliberately manual. The website reads GitHub's latest stable release metadata with five-minute revalidation and offers the exact `Freddai-macos-universal.dmg` asset. Drafts, prereleases, missing assets, invalid repository settings and API failures show the existing coming-soon state. Initial configuration requires a website deployment; subsequent published releases require no website rebuild. Run Next.js as a server, not a static export.

Linux downloads are retained as release assets pending runtime verification and website UI support. Windows is validation-only: enable the manual workflow's checkbox to attempt an unsigned NSIS build. The background host currently rejects non-Unix platforms, so Windows artifacts are never included in release drafts or advertised as supported. CI success alone is not platform runtime verification. Automatic in-app updates and web deployment are outside this workflow.

## Local checks

- `node --test apps/web/tests/download.test.mjs` (Node 24+)
- `pnpm typecheck`
- `pnpm --filter @freddai/web build`
- `pnpm native:install` for required local macOS delivery

The first GitHub run is still required to verify hosted runners, certificate import, notarization, universal compilation and Linux packaging.
