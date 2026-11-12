# Dashboard recovery — November 12, 2026

The reported old dashboard was a running-bundle mismatch. GUI PID 38875 mapped the cached November 8 executable `freddai-08f386dec04440f1d33e11482ba316d4a44e94c6f28da04293e5b9c3dce1fc20.app`, version 0.1.1, while `/Applications/Freddai.app` was version 1.0.1. Current workspace source still rendered the shared Office. No source rollback was performed during this recovery.

Opening by bundle identifier reproduced the stale launch: the native launch control returned PID 57277, which again mapped that cached 0.1.1 executable. Normal AppKit termination succeeded for each stale GUI. The old cached bundle was unregistered from Launch Services without deleting it or terminating its background host. Opening `/Applications/Freddai.app` explicitly launched PID 58838 from the installed path; an independent NSWorkspace identifier lookup then resolved to `/Applications/Freddai.app`. Accessibility and screenshot verification confirmed the current Commander and Office floor plan on Dashboard.

Source: existing user-owned changes preserved; no application source changes made for the rebuild. Tests: workspace typechecks and 1,005 frontend tests across 135 files passed. Web production build and Android debug APK build passed. Android physical delivery is blocked: adb reports no connected devices; connect and unlock the intended device and authorize USB debugging.

Mac build/sign/install: `pnpm native:install` completed with Developer ID team BSH2UEDLU5 and strict/deep signature verification. Companion install scripts rebuild the Mac bundle again, so the final GUI-to-installed-bundle identity must be rechecked after all scripts complete.

Recovery: the host moved to cached build `103c365f0a229a52b1e0aa4cc92d3c7cee6c2ea44ab7e89c0eb3f1f8cc8a84a3`; a read-only host snapshot confirmed this recovery thread running and the Tally thread waiting for user input. No new live provider turns or accounts were created as test fixtures. This verifies observed restart recovery, not reboot recovery.

Physical Apple delivery: installation complete on all three devices; launch verified on DiPhone, blocked by device locks on both iPads. The iPad Pro signed archive installed successfully into `C5DD4D2B-3BE2-420B-8520-82DBD2D0EA79`; launch was denied by SBMainWorkspace with `Locked` / FBSOpenApplicationErrorDomain 7. Installed version 1.0.1 was independently confirmed. Unlock the device before launch verification. The archive passed strict/deep codesign validation with Apple development team BSH2UEDLU5. Inventory contains DiPhone, 2021 iPad Pro 12, and 2022 iPad mini; simulators and Apple Watch excluded. Record each signed installation and verified running container below when complete.

DiPhone: rebuilt signed companion installed into `A6B2632D-B218-4A29-964C-87F31D3B96DA`; the install command successfully launched `com.freddai.companion`. Independent terminate-and-relaunch succeeded; PID 53821 mapped that same newly installed container, and devicectl independently confirmed installed version 1.0.1 and the running process.

Final delivery checks:

- Mac: after the final companion script rebuilt/reinstalled the desktop, normal AppKit termination succeeded for GUI PID 58838. Launching by bundle identifier now selected the current installed application: PID 82029 maps `/Applications/Freddai.app/Contents/MacOS/freddai-native`. Strict/deep signature verification passed. Built and installed executable SHA-256 both equal `b5c0f95b2054881a3fc53146e75d5eef5a989af3b6b8e359ae3a3f0a11f3f9a8`. The final accessibility tree contains Office, Office floor plan, and the Commander cluster.
- iPad mini: signed companion rebuilt and installed into `57381E79-5A56-4755-B7A8-27E10BC4750A`. Independent installed-app lookup confirmed version 1.0.1. Launch was refused with SBMainWorkspace `Locked` / FBSOpenApplicationErrorDomain 7; no running Freddai process was reported. Unlock the iPad mini and open Freddai to complete launch verification.
- iPad Pro: unlock and open Freddai to complete launch verification of its already installed update. No launch success is claimed.
- Android: existing debug signing passed `apksigner verify` (v2 scheme). No physical device appeared in adb; installation and launch remain blocked until connection, unlock, and USB-debugging authorization.
- Web: production build passed; no hosted deployment performed.
- Live providers: no new provider turns, account creation, or per-subscription tests were performed. Existing-thread recovery was inspected read-only.

No application data was erased and no agent processes were force-killed by this recovery. The old cached app remains on disk for its existing references; only its Launch Services registration was removed. Permanent source-level protection against launching cached host bundles was not added in this operational rebuild.
