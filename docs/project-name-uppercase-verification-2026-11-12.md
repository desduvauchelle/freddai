# Uppercase project names follow-up

Read thread 75ebbb9b-719d-47b3-9de9-51007eee0635 through its final message before implementation. Its prior install was not user-visible toggle verification.

Completed missing display paths: HomeView and CompanionDashboard pass the setting to shared Office. Office uses presentation copies of project records so SVG signs, room labels, character labels, schedule labels and tooltips consistently use the display name. IDs and source records remain unchanged. Desktop DashboardCall and companion review renderers pass the setting to their voice CommandCards. Voice matching still receives original names. Existing unrelated edits were preserved.

Observed automated results: app typecheck passed; 65 focused Office, desktop setting, companion dashboard and native payload tests passed; two additional desktop/companion voice-card tests passed. Extended desktop setting test passed after remount, toggling off, checking persistence calls and absence of project rename/update calls. Tests use fixtures, not live provider turns.

Delivery observations:
- macOS: pnpm native:install built, signed with existing Developer ID, installed /Applications/Freddai.app; codesign verified valid on disk and designated requirement. Initial running window was older. A later process (93815) mapped /Applications/Freddai.app/Contents/MacOS/freddai-native; this agent did not restart it. Subsequent ios:install invocations also reinstall macOS, so final running bundle freshness requires rechecking.
- DiPhone (00008140-00144DE80A7B001C): build/sign/install succeeded; launch denied because locked. Unlock and relaunch, then verify display.
- 2021 iPad Pro (00008103-001209062279001E): build/sign/install succeeded; launch denied because locked. Unlock and relaunch, then verify display.
- 2022 iPad mini (00008110-000579E00E7A801E): build/sign completed; install failed CoreDevice 4016, unable to assert required services/power/trusted connectivity. Unlock/connect and retry installation and launch.
- Android: SDK adb inventory empty. Existing debug signing/build completed an APK; no physical install or launch possible. Connect/unlock intended Android device and authorize USB debugging.

User-visible verification remains pending: UI control refused interaction while Freddai was in use. Asked user to coordinate restart and to switch away or authorize foreground interaction. No foreground takeover or GUI quit was performed. Switch appearance, live on/off behavior, app restart persistence, companion display and task recovery were not observed. Automated behavior is evidence for implementation, not proof of those live outcomes. No live-provider turn was used for testing.
