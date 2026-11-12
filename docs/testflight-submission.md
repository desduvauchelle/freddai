# Public TestFlight submission

App: Freddai, App Store Connect ID `6830788346`, bundle `com.freddai.companion`, team `BSH2UEDLU5`. One universal build supports iPhone and iPad.

Current status (November 12, 2026, 11:25 AM Pacific): **1.0.1 (2507.16.45) successfully exported and uploaded** after the owner signed back into Xcode. Xcode reported `Upload succeeded` and `EXPORT SUCCEEDED`. App Store Connect independently lists that exact build as **Processing**. External review has not been submitted and no public invitation exists. The beta review contact fields remain blank; the prepared copy below is not yet saved in App Store Connect. Foreground typing permission, feedback/review-contact details, and an existing privacy-policy URL were requested from the owner. Earlier failed attempts below are historical.

## Beta description

Freddai connects your iPhone or iPad to Freddai running on your Mac. Follow your projects and AI assistant conversations, send instructions and attachments, review progress, and respond to requests while away from your desk.

Requires a Mac with Freddai installed and running. Pair your devices on the same local network first. Your Mac runs the assistants using the accounts you configure there; the companion does not include an AI subscription. Keep your Mac online for remote access.

## What to test

Please test first-time Mac pairing, navigating projects and conversations, sending messages and attachments, responding to approvals, and reconnecting after a network interruption. On iPad, please also try rotation and multitasking. Send feedback and screenshots through TestFlight. Do not include passwords, API keys, or private project content in feedback.

## Review notes

This is a companion to the freely downloadable Freddai desktop app at https://freddai.ai-juicing.com. No Freddai account or companion login is required. Review requires a Mac and an iPhone or iPad on the same network for initial pairing.

1. Install and open Freddai on the Mac. Configure your own supported assistant account only if testing live assistant work.
2. Open Settings → Devices & satellite → Pair device on the Mac.
3. On the companion, enter a device name, the six-digit pairing code, and the Mac setup copied from the Mac settings.
4. Tap Connect and approve the request on the Mac.
5. The companion displays the Mac's projects and conversations. Keep the Mac running and online for subsequent access.

The Mac setup contains a public TLS certificate and address, not account credentials. Pairing requires explicit approval on the Mac. The release build does not bundle this developer's Mac connection information. There is no fixture or demo account in the submitted app.

## Publication requirements

The first external build requires Apple Beta App Review approval. Uploading an archive does not create an active public invitation. Create the Public Beta external group, attach the processed build, complete contact and beta review information, submit for review, and enable the public invitation after approval. Set the website's `TESTFLIGHT_PUBLIC_URL` only after verifying that invitation accepts testers.

At inspection on 2026-11-12, App Store Connect showed only 0.1.0 (2499.18.4), Ready to Test, explicitly Internal; no external group existed. This older archive cannot be made external merely by changing group membership.

## Verification on 2026-11-12

- Source: release-only empty provisioning; external-eligible upload; old internal archive rejection. Moved the existing preview URL parser into a platform-independent module after iOS and Android builds exposed a desktop-only module reference. Validation behavior is unchanged; concurrent user work was preserved.
- Tests: workspace typechecks passed; 135 app suites / 1,005 tests passed; nine native preview tests passed; shell/Python syntax checks passed.
- iOS archive: 1.0.1 (2507.16.45), `output/ios-distribution/2507.16.45/Freddai.xcarchive`, universal production assets, opaque icons and strict signature validation passed. The generated release provision is `{}`. The stored archive is development-signed; automatic App Store distribution signing/export subsequently succeeded during the 11:25 AM upload.
- Upload: attempted with the existing Xcode account. Apple returned `exportArchive Failed to Use Accounts` and `App Store Connect access for “BSH2UEDLU5” is required`; export exited 70. Reauthenticate the existing account in Xcode → Settings → Accounts, then retry `FREDDAI_IOS_ARCHIVE="$PWD/output/ios-distribution/2507.16.45/Freddai.xcarchive" pnpm ios:upload`.
- App Store Connect: beta description, feedback email, review contact and review notes were empty. Safari background text entry did not retain its value; no group was created and no metadata saved. Keyboard/pointer permission and the feedback email / review-contact phone / existing privacy-policy URL were requested.
- Initial publication status: upload was blocked before the owner reauthenticated. The later upload succeeded as recorded above; external review and public invitation remain pending. The website's TestFlight link remains unset.
- Android: production ARM64 APK rebuilt with the existing release key; signature, ZIP alignment and 16 KB native-library alignment checks passed. Artifact `output/android-release/Freddai-android-arm64.apk`, SHA-256 `487489460859101f6bb8b8e1a669c41be1b1760d238de3ae6e1b4dd88c7eb41f`. Physical install/launch blocked: adb inventory is empty. Connect an intended Android device, unlock it, enable USB debugging and authorize this Mac.

## Resumed delivery verification

The resumed upload at 08:58 on November 12 again failed with `Failed to Use Accounts` for team BSH2UEDLU5. This authentication blocker was resolved by the owner's subsequent Xcode login; the 11:25 AM upload of the same archive succeeded. Review submission remains pending.

The concurrent dashboard recovery completed the same workspace's local delivery through `pnpm native:install` and `FREDDAI_IOS_DEVICE=… pnpm ios:install`. These development installs are separate from the archived TestFlight release. Its installation logs and independent device/process results were inspected rather than starting competing builds. See `docs/dashboard-rebuild-2026-11-12.md` for that operational record.

- macOS: Developer ID signing, strict/deep verification and installation passed. Relaunched GUI PID 82029 maps `/Applications/Freddai.app/Contents/MacOS/freddai-native`; built and installed executable hashes match `b5c0f95b2054881a3fc53146e75d5eef5a989af3b6b8e359ae3a3f0a11f3f9a8`. Existing-thread recovery was observed by the recovery task; reboot recovery was not tested.
- DiPhone: signed version 1.0.1 installed into container `A6B2632D-B218-4A29-964C-87F31D3B96DA`, relaunched, and independently confirmed running as PID 53821 from that container.
- 2021 iPad Pro 12: signed version 1.0.1 installed into container `C5DD4D2B-3BE2-420B-8520-82DBD2D0EA79`; installed version independently confirmed. Launch failed with SBMainWorkspace `Locked` / FBSOpenApplicationErrorDomain 7. Unlock and open Freddai; launch verification remains incomplete.
- 2022 iPad mini: signed version 1.0.1 installed into container `57381E79-5A56-4755-B7A8-27E10BC4750A`; the recovery task confirmed installed version. Launch failed with the same `Locked` error. This task's subsequent installed-app query timed out after 20 seconds, and no running Freddai process was returned. Unlock and open Freddai; launch verification remains incomplete.
- Android: physical inventory still empty on resumption. The signed production APK is ready, but physical installation and launch remain blocked.
- Live providers and fresh public-beta pairing: not exercised. No accounts, credentials or provider turns were used as test fixtures. Physical development installs do not establish TestFlight availability or acceptance of the release archive.
