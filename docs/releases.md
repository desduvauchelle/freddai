# Desktop releases

Source repository: https://github.com/desduvauchelle/freddai (public). Production website: https://freddai.ai-juicing.com, hosted by the `freddai` Vercel project in the personal `desduvauchelles-projects` Hobby account. Vercel builds `apps/web` from `main`, includes workspace dependencies outside that directory, and uses Node 24. The Squarespace `freddai` CNAME points to `7ae8c160439a60c5.vercel-dns-017.com`.

`RELEASES_REPOSITORY=desduvauchelle/freddai` connects published release assets to the website. `SITE_URL=https://freddai.ai-juicing.com` is configured for production. The initial public desktop release is `desktop-0.1.0`: https://github.com/desduvauchelle/freddai/releases/tag/desktop-0.1.0. It promotes the verified artifacts from workflow run `41881098967` at commit `0d07bfc`, without recompiling them. Subsequent `v*` releases use the tag-driven draft workflow.

## Initial setup

1. The repository and Vercel Git connection are configured. `.gitignore` excludes build outputs, local caches, previews, environment files and signing material. Keep both lockfiles committed.
2. Configure Actions repository secrets: `APPLE_CERTIFICATE` (base64 Developer ID Application certificate exported as a password-protected .p12, including its private key), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (full Developer ID Application name), `APPLE_ID`, `APPLE_PASSWORD` (Apple app-specific password), and `APPLE_TEAM_ID`. The existing Developer ID was exported with a generated password and uploaded directly to this repository at the owner’s request. All six repository secrets are configured, including a dedicated Freddai app-specific password created by the owner. Temporary signing exports are not retained.
3. Configure `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` Actions secrets using the existing updater key matching the app's configured public key. Both are required by the packaging guard and are configured as of November 5, 2026; do not generate a replacement key merely to pass CI. Run **Package desktop** manually to validate builds. This uploads workflow artifacts without creating a release. macOS credentials are required even for manual runs; unsigned distribution builds are not silently substituted.
4. Set the deployed Next.js server's `RELEASES_REPOSITORY=owner/repo` to a public distribution repository. `MACOS_DOWNLOAD_URL` remains an optional HTTPS override. No token is required or sent to visitors.

The workflow creates drafts in the source repository using its built-in `GITHUB_TOKEN`. If source is private, copy the final installers into a release in a separate public distribution repository before publishing; automatic cross-repository publishing is not configured. Set the website repository to that public repository.

## Release a version

Update `apps/native/src-tauri/tauri.conf.json`, both Rust package versions, and workspace/native package versions together; refresh the lockfiles. Commit, then push a matching tag such as `v0.1.0`. The workflow rejects a tag that differs from the Tauri version.

macOS builds one signed and notarized universal DMG for Apple Silicon and Intel. Linux builds x64 Debian and AppImage packages. Builds and tests must all succeed before a draft is created. Reruns may replace draft assets but refuse to change published releases. Packaging arguments override local app-only bundling; `pnpm native:install` keeps its existing behavior.

Download the draft installers and verify clean installation, launch, provider discovery and normal application behavior on each claimed platform. Review release notes, then publish the draft as the latest stable release. Publishing is deliberately manual. The website reads GitHub's latest stable release metadata with five-minute revalidation and offers the exact `Freddai-macos-universal.dmg` asset. Drafts, prereleases, missing assets, invalid repository settings and API failures show the existing coming-soon state. Initial configuration requires a website deployment; subsequent published releases require no website rebuild. Run Next.js as a server, not a static export.

Linux downloads are published and recognized by the website. Debian installation and GUI-process startup are verified; interactive Linux behavior and AppImage execution remain unverified. Windows now has a native named-pipe host, CLI discovery and process supervision. The **Windows runtime** workflow builds an unsigned x64 NSIS installer and checks host startup/restart, core protocol tests, the PowerShell terminal, installation, visible native launch and GUI reopen. Download its `Freddai-windows-x64` artifact for testing. This is separate from the signed macOS/Linux release pipeline; no Windows release is published automatically. CI success alone is not platform runtime verification. Vercel handles web deployment independently on pushes to `main`. Changes to the packaging workflow also trigger installer validation. The separate Checks workflow runs typechecking, web/native frontend builds, web/relay tests and core Rust tests on pushes and pull requests.

## In-app updater artifacts

Each release also publishes Tauri v2 updater artifacts and a `latest.json` manifest, built by the same workflow (`--config '{"bundle":{"createUpdaterArtifacts":true}}'`; `tauri.conf.json` does not enable it locally, so `pnpm native:install` is unchanged).

- Secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Set them with `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/freddai-updater.key` and `security find-generic-password -s freddai-updater-key -w | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The matching public key is `plugins.updater.pubkey` in `tauri.conf.json`. The package job fails immediately with a named error if either secret is missing. Windows validation receives the secrets but does not build updater artifacts.
- Extra assets (besides the unchanged DMG/deb/AppImage names): `Freddai-macos-universal.app.tar.gz` and `.sig` (macOS), `Freddai-linux-x64.AppImage.sig` (Tauri v2 signs the AppImage itself; there is no separate Linux tarball), and `latest.json`.
- `latest.json` is generated in the draft job by `scripts/generate-updater-manifest.mjs` (test: `node --test scripts/tests/updater-manifest/`). `darwin-aarch64` and `darwin-x86_64` both point at the universal tar.gz, `linux-x86_64` at the AppImage; URLs are `https://github.com/desduvauchelle/freddai/releases/download/<tag>/<asset>`.
- Clients fetch `https://github.com/desduvauchelle/freddai/releases/latest/download/latest.json`. GitHub's `/releases/latest` only resolves a published, non-draft, non-prerelease release, so users receive an update only after you publish it.
- Linux `.deb` installs cannot self-update; they are shown a link to the release instead. Only the AppImage updates in place.
- The initial `desktop-0.1.0` release had no updater feed. The public feed became available with v0.1.1. Local builds log automatic check failures quietly; manual checks and distributed builds still report failures.
- v0.1.0 has no updater: users must install the first updater-enabled version manually.
- Verified by the successful v0.1.1 tag run: the exact bundle output paths, updater signatures, manifest generation and `--config` JSON quoting through tauri-action.

## Local checks

- `node --test apps/web/tests/download.test.mjs` (Node 24+)
- `pnpm typecheck`
- `pnpm --filter @freddai/web build`
- `pnpm native:install` for required local macOS delivery

The initial hosted runs exposed desktop compilation and CLI-dependent test failures. Those are corrected in `0d07bfc`; its Checks workflow passed. Installer validation run `41881098967` passed on all three platforms. The universal Mac app passed Developer ID signature verification, stapled-ticket validation and Gatekeeper assessment. Linux install/startup run `41883242256` passed on Ubuntu 22.04. The Linux verification workflow now runs after successful main-branch packaging and supports manual validation of a packaging run. This is a process-startup check, not interactive UI or live-provider verification.

## Website platform assets

The download section recognizes these uploaded assets in the latest published stable release: `Freddai-macos-universal.dmg`, `Freddai-linux-x64.AppImage`, `Freddai-linux-x64.deb`, and `Freddai-windows-x64-setup.exe`. Windows workflow artifacts are not automatically published under that release filename. Publish a validated installer deliberately; Windows Authenticode signing and updater signing remain separate distribution setup. Set `TESTFLIGHT_PUBLIC_URL` only to an active Apple public invitation URL after external beta review; absent releases remain visibly unavailable.

The current iOS build uses this developer Mac's compile-time endpoint and certificate. Do not distribute it as a general external beta. A generic secure pairing/enrollment flow must precede external testing. App Store Connect beta review and tester setup remain pending.

## iOS and iPadOS internal TestFlight

The companion is one universal iOS app (`com.freddai.companion`, team `BSH2UEDLU5`) for both iPhone and iPad. There is no separate iPad bundle, listing or release stream. The existing shared native shell adapts to the app window; iPad supports all four orientations and multitasking.

On this Mac's Xcode 27 toolchain, optimized Swift plugin linking also requires Rust's LLVM tools (`rustup component add llvm-tools`). The debug simulator build alone does not verify release linking.

- `pnpm ios:archive` builds a **release**, non-fixture archive into `output/ios-distribution/<build-number>/Freddai.xcarchive`. It uses the existing Mac TLS provisioning without including device authentication secrets. The build number defaults to days since 2020, UTC hour and minute, satisfying Apple's 4.2.2 digit limits. To build twice in one minute, set an explicit greater `FREDDAI_IOS_BUILD_NUMBER`. Existing archive directories are never overwritten.
- Archive validation checks the bundle ID, iPhone/iPad device families, iPad orientations, multitasking, opaque App Store icons, and production frontend assets. The icon preparation step encodes the existing artwork into opaque RGB in the generated Xcode catalog; source artwork is retained. `Freddai-build.json` records asset hashes and binds production validation to the archived executable hash. Tauri embeds compressed web assets in that binary. Fixture mode is rejected for distribution; the production flag is also set explicitly to override local Vite environment files.
- `pnpm ios:upload` uploads the latest validated archive using Xcode automatic distribution signing and the existing Xcode account. Set `FREDDAI_IOS_ARCHIVE` to select a specific archive. Xcode may create distribution signing material with that account. No passwords, API keys or certificates are stored in source. This upload uses `testFlightInternalTestingOnly=true`: it cannot be released to external testers or the App Store.

Use the existing iOS App Store Connect record for `com.freddai.companion` under the same developer team; do not create a separate iPad record or change the bundle ID of an installed companion. The existing account/record accepted the universal upload on 2026-11-04. If the command reports a missing account/session in another environment, sign in to **Xcode → Settings → Accounts** with the existing developer account. After a successful upload, wait for Apple processing, resolve any build-specific compliance requirements, then assign the build to an internal testing group. Upload alone does not assign testers or establish a public TestFlight invitation. Apple processing, tester assignment and actual installation must each be verified separately.

Verified upload: **0.1.0 (2499.18.4)**, universal iPhone/iPad, internal testing only. Xcode reported `Upload succeeded` and `EXPORT SUCCEEDED`; App Store Connect reported the package had begun processing. Archive: `output/ios-distribution/2499.18.4/Freddai.xcarchive`. The first attempted upload was rejected for the original PNG icon alpha channel; the final upload includes opaque generated icons and passed that validation. Completion of Apple processing, internal testing-group assignment, physical-device TestFlight installation and public availability have not been verified.

External distribution still requires generic secure Mac enrollment (the current build trusts this developer Mac), production acceptance and store metadata/review, including iPad screenshots. The website's public TestFlight link stays unset until external testing is actually available. Distribution follows [Apple's upload workflow](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds) and [Tauri's App Store workflow](https://tauri.app/distribute/app-store/).

## Apple setup status (2026-11-04)

App Store Connect contains Freddai, Apple ID `6830788346`, bundle ID `com.freddai.companion`. The Internal Testing group exists with manual distribution and no testers or builds. External testing is not yet available on this empty build record. Apple Developer account shows the updated Program License Agreement accepted November 4, 2026; no acceptance action remains pending.

All three published installer files were downloaded from their public GitHub release URLs and matched the CI artifacts by SHA-256. The production website was redeployed and its Mac, Linux AppImage and Debian links verified against those URLs.


## Android APK beta

See [Android installation and release signing](android.md). Android uses the separate `android-beta-0.1.0` prerelease, with `Freddai-android-arm64.apk` and a SHA-256 checksum; it never replaces desktop’s latest stable release. Vercel’s production `ANDROID_DOWNLOAD_URL` enables the landing-page Android beta button only after the asset is published and checked. The Android app enrolls each user’s own Mac at runtime. Existing public Mac builds can use the documented public provisioning helper; current Mac source exposes setup directly in Pair phone. Physical-device pairing, relay and live-provider verification remain pending.


Android beta upload verified: anonymous APK download matches SHA-256 `b1c5046f62447d7b3738e993ce23200521fe0f7b0c1f005daf386ebfcdc5e5e0`. The production Vercel Android download setting is configured. The push also triggered desktop packaging of the accumulated workspace changes; those jobs stopped before building because GitHub updater signing secrets are absent. This does not affect the separately signed Android release; desktop stable assets remain unchanged.

## Windows runtime (November 5, 2026)

Windows uses local named pipes restricted to the owner and SYSTEM, with remote clients rejected. The cached background executable has an `.exe` suffix and survives closing the GUI. Provider trees are started suspended, assigned to kill-on-close Windows Job Objects and then resumed. Discovery recognizes native executables and npm `.cmd` shims, uses Windows PATH separators and USERPROFILE/AppData defaults, and leaves existing CLI credentials intact. Claude/Gemini interactive sign-in opens a separate PowerShell console; Codex/Grok retain their browser login flow. The integrated terminal uses PowerShell through ConPTY. Start-at-login uses a per-user Run registry entry.

Build locally on Windows with Node 24, pnpm, the Rust MSVC toolchain, Visual Studio C++ build tools, and WebView2: `pnpm install --frozen-lockfile`, then `pnpm --filter @freddai/native tauri build --bundles nsis`. Install the executable from `target/release/bundle/nsis/`. Agent CLIs and Git must be installed separately. A valid CLI sign-in is still required to start work; the app does not invent accounts.

The Windows installer is unsigned (no Windows signing certificate was configured). Voice dictation, computer-use automation and phone hosting remain macOS features. Live Windows account sign-in and subscription/provider validation require explicit testing with the owner's selected accounts; automated checks use protocol processes and empty temporary workspaces only. Windows UI inspection uses Windows UI Automation and screenshots of the installed release app; it does not enable debugging or change production configuration.

Verified preview: [Windows installer artifact](https://github.com/desduvauchelle/freddai/actions/runs/42128911396/artifacts/13462183696), `Freddai_0.1.0_x64-setup.exe`, SHA-256 `dca1e5ad486da4ad636921191c031eee9d5e6d620dbab29e925a4d69149432c8`. [Acceptance run 42130174898](https://github.com/desduvauchelle/freddai/actions/runs/42130174898) reused this exact installer and passed installation, rendered accessible account controls, host binary hash matching, empty-profile snapshot, normal GUI exit/host survival, reopen and normal final exit. The producing run passed core, terminal and host-identity tests; its original UI harness was corrected before acceptance. The preview is not published through the public download/update feed and may display an unavailable-feed warning. It contains the committed baseline plus the Windows port; unrelated unfinished local work is excluded.

## 0.1.1 release preparation (November 5, 2026)

The accumulated desktop, companion, Windows runtime, scheduling, MCP bridge, office and UI changes are being released as 0.1.1. The existing local updater key and its Keychain password were configured as GitHub Actions secrets without rotating keys. Public desktop installers must come from the matching tag workflow; a source push alone does not update downloads. Verification and publication results are recorded after packaging.

The macOS distribution minimum is explicitly 10.15 because the voice library uses C++17 filesystem APIs; Tauri’s implicit 10.13 build target cannot compile that dependency. The bundled computer-use helper remains a macOS 14+ feature. Release preparation also corrected clean-runner helper ordering, schedule snapshot expectations, long-hostname certificate generation and the older-WebKit regression fallback.

Nested macOS code is signed before Tauri seals the parent app: release CI imports the existing Developer ID using the pinned Apple-Actions certificate import action, and `build-computer-use.sh` applies hardened-runtime Developer ID signing plus a secure timestamp when `FREDDAI_COMPUTER_SIGNING_IDENTITY` is set. Local `native:install` retains its existing explicit helper/parent signing path. The missing nested signature was detected by Apple notarization; distribution must wait for a successful notarization result.

## Published 0.1.1 verification (November 5, 2026)

Release: https://github.com/desduvauchelle/freddai/releases/tag/v0.1.1. Native release source: `fc19bb9`. Successful packaging and notarization: https://github.com/desduvauchelle/freddai/actions/runs/42150224026. The release is published as latest stable. Android 0.1.1 is the separate prerelease at https://github.com/desduvauchelle/freddai/releases/tag/android-beta-0.1.1.

- Source: the starting workspace changes were committed and pushed, followed by the release fixes. New work created concurrently after the release snapshot remains in the working tree.
- Tests: workspace typechecking, 390 frontend tests, Rust workspace tests and production website integration checks passed. The website copy update also passed typechecking, download tests and production build.
- Build: universal macOS, Linux AppImage/Debian and Windows x64 NSIS packaging passed. Android production APK generation, non-fixture checks, alignment and signature verification passed.
- Signature: the downloaded universal Mac app passed strict recursive verification across both architectures, stapled notarization-ticket validation and Gatekeeper assessment as Notarized Developer ID. Both the parent and computer-use helper use the existing Developer ID. Windows remains an unsigned beta and its website card says so. Android 0.1.1 retains the 0.1.0 signing certificate and increases versionCode from 1000 to 1001.
- Install: `pnpm native:install` rebuilt, Developer ID signed and installed `/Applications/Freddai.app`, with strict installed-signature verification. The final Linux artifact passed clean Debian installation and process startup in https://github.com/desduvauchelle/freddai/actions/runs/42151207194. Windows installer validation passed in the packaging run; the separate Windows runtime workflow previously verified visible launch/reopen with the same Windows application source.
- Launch: the local GUI still maps an older preserved bundle. Approved `orca` native-app controls are unavailable, so no local GUI relaunch was performed. Save drafts, quit Freddai normally, and reopen `/Applications/Freddai.app`. Linux validation establishes process startup, not interactive behavior. Mac release Gatekeeper checks do not establish installed GUI launch.
- Live providers: not tested; no connected accounts, sign-ins or live agent turns were used as fixtures. Physical Android pairing and iPhone/iPad external availability remain unverified/pending.
- Public downloads: all nine desktop release assets were downloaded without authentication and matched the staged CI artifacts by SHA-256. The anonymous Android APK matched SHA-256 `bfda9eaff43cb458715171d639aa9015e8cc151bcd3aa0a1d6c4566e5a0481a7`. The public `releases/latest/download/latest.json` feed returns version 0.1.1 and signed Mac/Linux platform entries. `SHA256SUMS` is included in the desktop release. The Windows installer is deliberately published as `Freddai-windows-x64-setup.exe`, enabling the existing website discovery path.

## Linux portable download correction (November 8, 2026)

The Omarchy report shows a file-manager association error before Freddai launches. Browser-downloaded standalone AppImages require executable permission; Debian packages target Debian/Ubuntu rather than Arch. A new `Freddai-linux-x64.tar.gz` wraps the existing released AppImage with mode 0755 and `docs/linux.md` as README. The original binary, updater signature and version are unchanged. A separate archive checksum accompanies it. The website prefers this uploaded archive and links installation instructions, including terminal launch and FUSE-free extraction. Future desktop packaging also produces the archive.

The manual **Verify Linux portable archive** workflow downloads a published AppImage, checks its GitHub SHA-256 digest, packages it, verifies extracted permissions and byte identity, then extracts and launches the app without FUSE on Ubuntu 22.04 with empty temporary app directories. This does not verify Omarchy's file manager, interactive UI, or live providers. Publication and local delivery results are recorded after verification.

Verified Linux portable publication:

- Source/spec: `a778516` adds packaging, download discovery and the guide; `f95ae14` adds the spec contract without committing unrelated workspace edits.
- Tests: archive unit check, workspace typechecking, web download tests, production website integration checks and web production build passed. Checks run `42507796930` passed. Portable acceptance run https://github.com/desduvauchelle/freddai/actions/runs/42507797147 passed permissions, released-binary byte identity and 20-second FUSE-free process startup, with frontend/host snapshot traffic visible in its log.
- Build: this is a distribution wrapper around the existing 0.1.1 AppImage, not a newly compiled Linux binary. The archive's SHA-256 is `4a6723ba79d31dfa970cd13fec7de922cbb7a345d211faf3693154cbffe6798b`. It contains only the executable AppImage and README.
- Signature: the original AppImage remains byte-identical to the signed release (`836b8e5a997568d61759fbf36d2d45e5281ea52b6698073ab13160ae0f0bec1c`). The archive has a separate SHA-256 checksum; it is not an updater artifact and does not replace the signed updater feed.
- Public upload: https://github.com/desduvauchelle/freddai/releases/download/v0.1.1/Freddai-linux-x64.tar.gz and its `.sha256` asset were uploaded. An anonymous download of the archive matched the verified CI artifact. The production website serves the Omarchy guide link and package guidance; its five-minute release metadata cache may briefly retain the standalone AppImage link.
- Local macOS build/signature/install: `pnpm native:install` passed and installed `/Applications/Freddai.app`, signed with the existing Developer ID Application, team `BSH2UEDLU5`. Strict installed signature verification passed. This local build includes the existing working tree; those unrelated changes were excluded from the distribution commit.
- Local launch/recovery: native window listing found the current GUI; `computer_observe` failed with ScreenCaptureKit error `-3811` (audio/video capture failure). No alternate restart mechanism was used. The running GUI still maps the preserved previous bundle; save drafts, quit Freddai normally and reopen `/Applications/Freddai.app`. New-bundle launch and task recovery were not verified.
- Live providers / Omarchy: no live agent turns, sign-ins or account creation were used. Interactive Omarchy acceptance remains the user's retry; the Linux runner verifies Ubuntu process startup only.

Follow-up checks: the production Linux button now resolves to the new `.tar.gz` asset (verified after cache refresh). Checks run `42507891447` also passed. The packaging-workflow edit separately triggered run `42507796881`; its Windows host validation failed at the existing `windows-host.ps1:25` assertion, “Large snapshot was truncated.” No Windows runtime code was changed or new Windows installer published by this fix. That broader packaging result is separate from the successful, published Linux archive acceptance run.
