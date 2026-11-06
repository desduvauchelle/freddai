# Freddai

macOS desktop proof of concept with a Rust process host and React/shadcn conversation interface. Product definition: [docs/spec.md](docs/spec.md).

## Local development

Use Node.js 22.12+ (Node 24 LTS recommended), pnpm 11.25.0, and a current stable Rust toolchain. Native builds additionally require the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install
pnpm dev          # Next.js marketing website, http://127.0.0.1:3000
pnpm dev:app      # Product browser preview, http://127.0.0.1:1420
pnpm native:dev   # Native Tauri desktop app
pnpm check       # Typecheck, both frontend builds, Rust workspace check
```

`pnpm native:build` builds a macOS app bundle in `target/release/bundle/macos/Freddai.app`. Local development bundles are not distribution-signed or notarized. A debug bundle is available via `pnpm --filter @freddai/native tauri build --debug`. `cargo check` checks the shared core by default; `cargo check --workspace` includes the native host.

## iPhone companion

The universal iPhone/iPad app mirrors Mac projects, threads and conversations, with search, status/project filters, sorting, replies, new threads and explicit pending-request responses. Both devices use the same native shell, thread list, composer and companion client. In iPad landscape windows at least 900 points wide with a regular horizontal size class, the thread list opens beside the conversation; selecting or creating a thread keeps it visible. The Threads button toggles it. Portrait and narrow multitasking windows use the reveal drawer. Rotating/resizing reuses the existing controllers and preserves the composer. The default thread list groups by project, orders by latest user message sent, and shows five active threads per project. Show older threads reveals ten at a time, with remaining counts, day separators and Hide older threads. Completed conversations move to older history after reading and remain available in Finished. It has no provider/account/project configuration screens. Work executes on the Mac using existing routing defaults. Keep the Mac awake and online with Freddai's companion listener running. Pair once on the same local network: Mac Settings → Phone pairing → Pair phone, enter the six-digit code on the device, and approve it on the Mac. After pairing, the configured encrypted internet relay supports cellular and other Wi-Fi networks. Push notifications and remote wake are not implemented.

```sh
pnpm ios:install
# To select a phone explicitly:
FREDDAI_IOS_DEVICE=<device-identifier> pnpm ios:install
```

The repeatable installer provisions a private Mac TLS authority, rebuilds/signs/installs the macOS app, starts its signed companion listener without terminating existing agent work, builds the native Tauri iOS project, and installs/launches it on the paired iPhone or iPad through Xcode's device controls. Unlock the device for launch. With multiple connected devices, set `FREDDAI_IOS_DEVICE` to the intended device identifier. It uses the existing Xcode Apple Development identity/team. Xcode, CocoaPods, xcodegen, libimobiledevice and the iOS Rust target are required. The generated Xcode project is under `apps/native/src-tauri/gen/apple`.

`pnpm ios:test:layout` runs native layout/controller tests on an available iPad simulator (`FREDDAI_SIM_DEVICE` selects a simulator UDID). `pnpm ios:test:ui` builds/installs the offline fixture and exercises selection, rotation, draft retention and the iPad picker on that simulator. `FREDDAI_SIM_DEVICE=<simulator-UDID> pnpm --filter @freddai/native ios:sim:fixture` builds/installs the shared offline fixture on that simulator, even when another simulator is already booted. `pnpm ios:archive` prepares a universal release archive; `pnpm ios:upload` uploads that archive to internal TestFlight using the existing Xcode account. See [iOS distribution setup and limitations](docs/releases.md#ios-and-ipados-internal-testflight).

The phone build embeds this Mac's address and public TLS trust certificate, with no device authentication secret. Pairing uses a single-use six-digit code valid for three minutes with a five-attempt limit, followed by explicit Mac approval. Each approved phone receives a separate random credential, stored in iOS Keychain. Revoke individual phones in Mac settings. The private Mac device registry lives under Application Support `companion`; the former shared installation token is no longer accepted. Initial pairing still targets the Mac provisioned by the installer; discovery of other Macs is not implemented.

The encrypted relay is deployed at `https://freddai-companion-relay-production.up.railway.app` in the separate Railway project `freddai-companion-relay` and is configured on this Mac. Configure or disable it in Mac Settings → Phone pairing. When changing relay addresses, connect the paired phone locally once to save the new address. The Mac uses outgoing HTTPS only; no router port forwarding is needed. The relay carries AES-256-GCM ciphertext, never device encryption keys or provider credentials. See [relay operation and limits](services/relay/README.md). A Mac that is asleep, offline, or logged out cannot run remote work.

The Mac listener binds HTTPS port 49744 and exposes only companion operations and local pairing. Refreshing the detached listener through `scripts/start-companion.py` does not terminate the GUI or agent host. A GUI already running after an install must still be quit normally and reopened to load new settings.

The separate iOS frontend bundles only companion screens. A disconnected UI preview remains available at `http://127.0.0.1:1420/?companion=1`; it never dispatches work. `pnpm --filter @freddai/native build:ios` builds the iPhone frontend alone. Phone drafts persist in app-local storage; loaded transcripts remain in memory while disconnected.

## Structure

- `apps/web`: Next.js public website.
- `apps/native`: product React entry point and Tauri Rust host.
- `packages/app`: product screens shared across native targets and browser preview.
- `packages/ui`: shared styles and shadcn component destination.
- `crates/core`: platform-independent Rust domain logic.

The website uses Next.js, Tailwind CSS, daisyUI themes, and the Recursive Engine client/server SDK foundation. The landing page uses published GitHub release metadata for desktop downloads and a configured Android beta URL; CMS credentials remain unconfigured. See [website setup](apps/web/README.md). Read the Orca reference policy in the specification before implementing related features.

## Desktop setup

1. Open the built Freddai app (the browser preview cannot invoke local agents).
2. Add a project and choose its local folder.
3. In Accounts, add a named Codex or Claude Code profile for each subscription.
4. Choose **Sign in in Terminal** for each profile, finish the provider login, then **Check sign-in**.
5. Select a project and account in **New thread**. Project and global defaults are available in Settings.

Installed `codex` and `claude` CLIs are required. Account sign-in uses Freddai-owned directories; existing `~/.codex` and `~/.claude` configurations are not imported or replaced. Workspace metadata and transcripts live in macOS Application Support under `com.freddai.desktop`. Credentials remain in the provider's account directory or provider-managed credential store.

Press **Cmd+/** for the complete implemented shortcut map. All supported dialogs, selects, requests, and thread controls are keyboard reachable. VoiceOver and installed-app keyboard validation remain outstanding.

This is an early native implementation, not a verified distribution release. Live subscription authentication, two-account identity isolation during real turns, image ingestion, and long-running workloads still need acceptance testing. Attachments currently send local file references, not copied/uploaded payloads. Codex uses app-server; Claude uses the CLI streaming control protocol. Unsupported interactions fail closed. Usage meters, background scheduling, external conversation import, worktrees remain subject to the specification; mobile connectivity supports local access and a configured encrypted relay after local pairing; physical cellular acceptance remains unverified.

### Tests

```sh
cargo test -p freddai-core
node --test packages/app/tests/desktop.test.mjs
pnpm typecheck
```

The Node tests use TypeScript stripping; use Node 24 (or Node 22 with `--experimental-strip-types`). Process tests use a scripted local provider and do not spend tokens or authenticate. They are not evidence of a live provider task completing.

Android companion: see [build, installation and offline UI checks](docs/android.md). Run `pnpm android:build` to produce a development APK or `pnpm android:install` with an authorized Android device connected.
