# Android companion

The Android app follows the iOS hybrid architecture: Kotlin navigation, thread drawer, composer, file picker and dialogs around the shared React conversation/pairing WebView. The Mac runs the agents.

## Build

Install JDK 21, Android command-line tools, platform-tools, SDK platforms 36 and 37, build-tools 36.0.0 and NDK 28.2.13676358. Set `ANDROID_HOME` (default `~/Library/Android/sdk`) and `NDK_HOME` if using another NDK. Rust Android targets are installed by Tauri initialization.

Android builds contain no developer Mac endpoint, certificate, accounts or pairing credentials. Each user supplies their own Mac’s public setup while pairing. The existing iOS compile-time provision remains unchanged.

Run `pnpm android:build`. APKs are under `apps/native/src-tauri/gen/android/app/build/outputs/apk/`. The default is arm64; set `FREDDAI_ANDROID_TARGET=x86_64` for an x86 emulator. This creates a development-signed debug build, not a Play Store release.

## Install and connect

Enable USB debugging, connect and authorize the intended Android device, then run `pnpm android:install`. When multiple devices exist, set `FREDDAI_ANDROID_DEVICE` to its adb serial. The installer preserves app data with `adb install -r`.

Open Freddai on the Mac, use Settings → Pair phone, transfer the displayed Mac setup text to Android using a trusted method, enter its six-digit code and approve the device on the Mac. Mac setup contains only the HTTPS endpoint and public CA certificate. The phone pins that CA, disables redirects, and stores the approved Mac setup with credentials encrypted by Android Keystore. Failed setup or approval does not replace an existing pairing. The first pairing needs both devices on the same local network. Remote use needs the existing Mac relay configuration.

## Verification boundaries

Use the existing `VITE_COMPANION_FIXTURE=1` build flag only for isolated emulator UI checks. Production builds omit fixture content. Never pair accounts or execute provider turns as test fixtures. Verify real-device pairing, uploads and relay access separately with explicit authorization.

Android offers Photos, Files and delegated system Camera capture, composer and dashboard dictation, and a persistent landscape sidebar on sufficiently wide tablet windows. The native dashboard shares the iOS single-scroll workspace, summaries, project controls and Schedules layout. The direct-download beta uses the persistent release identity and runtime Mac enrollment described below.

For an offline UI smoke test, boot a dedicated Android emulator, build with `VITE_COMPANION_FIXTURE=1 pnpm android:build`, install that APK on the emulator, then run `python3 scripts/test-android-ui.py`. The script refuses physical device serials and checks for fixture content before interacting. It covers the native drawer, filters, thread selection, Back, picker dismissal/reopening and typed-draft retention across rotation and Activity recreation. Rebuild with `VITE_COMPANION_FIXTURE=0 pnpm android:build` before distributing an APK.

## Install the public Android beta

1. Download **Freddai-android-arm64.apk** from [the Android beta release](https://github.com/desduvauchelle/freddai/releases/tag/android-beta-0.1.0). It supports ARM64 Android phones (minimum Android 7; Android 12+ recommended for `.local` hostname resolution). Intel Android devices are not supported by this APK.
2. Open the APK on the phone. When prompted, allow your browser to install unknown apps, then install Freddai. You may switch that permission off afterwards. No Play Store account is required.
3. With the current Mac source build, open **Settings → Pair phone**, transfer the **Mac setup** text to your phone, enter the six-digit code and approve on the Mac. Keep both devices on the same local network and allow Freddai through the Mac firewall. Trust only setup copied from your own Mac.
4. Existing public Mac 0.1.0 builds predate the Mac setup field. With a checkout of this repository, run `python3 scripts/provision-iphone.py` on your Mac, reopen Freddai, and copy the public setup text using `cat "$HOME/Library/Application Support/com.freddai.desktop/companion/iphone-provision.json"`. Paste it into Android’s Mac setup field, then use **Settings → Pair iPhone** on that Mac to generate the six-digit code and approve Android. This helper creates local TLS identity files; never share `ca.key`, `server.key` or `devices.json`. Only the public JSON setup is transferred.
5. Outside your home network, remote access requires the existing hosted relay configuration. The Mac runs the agents and must stay awake and online. The app does not run coding agents directly on Android.

To update, download the next APK and install it over the existing release. The signing key must stay the same to preserve app data. Development APKs use a different signature: Android cannot replace them with a release APK. Remove a development install manually if desired; uninstalling erases its pairing and drafts. The release script never uninstalls a user’s app.

## Reproduce and sign a release

Run `pnpm android:release` on this Mac. The command forces production UI, rejects fixture mode, builds ARM64 release code, aligns and signs the APK, verifies its signature and ZIP alignment, rejects debuggable output and writes a SHA-256 checksum. Outputs are in `output/android-release/`; they are not committed.

The first invocation creates a persistent RSA release identity at `~/Library/Application Support/com.freddai.desktop/signing/android-release.p12` with its password in the login Keychain item `com.freddai.android.release` (account `release`). Later invocations reuse it and refuse to rotate a missing key silently. Back up both securely before releasing further updates. No signing secrets belong in GitHub source or public release assets.

Publish the APK and `.apk.sha256` as an Android-specific prerelease, keeping desktop’s latest stable release unchanged. Set Vercel’s `ANDROID_DOWNLOAD_URL` to the verified public HTTPS APK URL and deploy. The landing page keeps the Android button unavailable when this setting is absent or invalid. Direct distribution is supported by [Android’s website distribution guidance](https://developer.android.com/distribute/marketing-tools/alternative-distribution); developer registration/verification and Play Store listing are separate, owner-managed tasks.

## Beta verification (2026-11-04)

Production release APK: built, release signature verified, 16 KB ZIP and native ELF alignment verified. Installed and opened in the dedicated ARM64 Android 16/API 36 emulator; the production Mac setup form appeared with no fixture conversations. Unit checks cover setup rejection, approval gating and preservation of existing Mac identity. No physical phone, real-device pairing, relay, attachment transfer, credential persistence after a real pairing or provider turn was exercised. Public beta availability does not imply those checks passed. That beta predates the November 5 Android parity changes; its camera/dictation limitations do not describe the current source. See the parity verification below for the rebuilt APK.

## Android parity update (2026-11-05)

Current source includes the native single-scroll dashboard and cached summaries, compact project controls, composer dictation (including release-to-send), image attachment previews, delegated Camera capture, and the landscape tablet thread sidebar. Shared conversation/upload/read-state/connection fixes are included by rebuilding the shared mobile entrypoint. Android retains Android-native controls and Keystore storage; it does not run agents on the phone.

For the complete offline acceptance run, build with `VITE_COMPANION_FIXTURE=1 pnpm android:build`, install on a **dedicated** emulator, and run `FREDDAI_ANDROID_DEVICE=emulator-<port> python3 scripts/test-android-parity.py`. This includes the baseline UI smoke test and builds a separate self-targeted accessibility probe to inspect animated screens without an idle wait. The probe never instruments or restarts Freddai. Tablet checks temporarily override only that emulator's display size/density, then reset them. It uses synthetic fixture connections and never contacts a provider. Use `pnpm android:release` afterwards for the distributable production APK; never distribute the fixture APK or test probe.

The November 4 public beta URL above is historical; producing a local signed parity APK does not replace that hosted release. Verification details for this update are recorded in `docs/spec.md`.
