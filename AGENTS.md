# Freddai implementation instructions

- Preserve existing behavior and user-owned work. Trace the actual runtime path before changing code; distinguish confirmed evidence from assumptions.
- For every application change, run appropriate checks, rebuild the macOS app, sign it using the user's existing Developer ID, and reinstall it in `/Applications/Freddai.app` before reporting delivery. Use `pnpm native:install` for the repeatable build/sign/install path. A source edit or browser preview alone is not delivery.
- After installing, relaunch through approved native-app controls and verify the running instance uses the new bundle. Do not assume an already-running process reloads a replaced application. Preserve drafts and active agent work; never force-kill it just to update.
- If native-app control is denied, do not bypass the restriction. State that the installed update is ready but the running instance still needs restarting, with the exact user action needed. Never claim the new version was launched or tested when only installation was verified.
- Keep the spec current. Report source/tests/build/signature/install/launch/live-provider verification separately.
- Do not use accounts, credentials, or live agent turns as test fixtures. Account creation, sign-in, and per-subscription validation must be explicit; never fabricate connected accounts to enable Start.
