$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run this installation test on a disposable GitHub Actions Windows runner.' }
$nativeRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.freddai.desktop'
if (Test-Path $nativeRoot) { throw 'Refusing to test against an existing Freddai workspace.' }
$installer = (Get-ChildItem 'target/release/bundle/nsis/*.exe' | Select-Object -First 1).FullName
$probe = (Resolve-Path 'target/debug/examples/host_probe.exe').Path
$fixture = Join-Path $env:TEMP ('freddai-install-test-' + [guid]::NewGuid())
$install = Join-Path $fixture 'app'
$saved = @{}
foreach ($key in @('APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME')) { $saved[$key] = [Environment]::GetEnvironmentVariable($key) }
$debugArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$app = $null
$root = $null
try {
  # Empty profile: no provider accounts, credentials or agent turns are fixtures.
  foreach ($key in $saved.Keys) {
    $dir = Join-Path $fixture $key
    New-Item -ItemType Directory -Force $dir | Out-Null
    [Environment]::SetEnvironmentVariable($key, $dir)
  }
  $setup = Start-Process $installer -ArgumentList @('/S', ('/D=' + $install)) -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
  $binary = Join-Path $install 'freddai-native.exe'
  if (!(Test-Path $binary)) { throw 'Installed executable missing' }
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
  $app = Start-Process $binary -PassThru
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $app.Refresh()
    if ($app.HasExited) { throw "App exited during startup: $($app.ExitCode)" }
    if ($app.MainWindowHandle -ne 0) { break }
  }
  if ($app.MainWindowHandle -eq 0) { throw 'No native app window appeared' }
  node scripts/tests/windows-ui.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Installed app UI verification failed' }
  # Tauri uses the Windows known-folder API, which intentionally ignores APPDATA overrides.
  $root = $nativeRoot
  $hello = & $probe hello $root | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Installed host handshake failed' }
  if (!(Test-Path $hello.build) -or !($hello.build.EndsWith('.exe'))) { throw 'Host is not using the cached Windows executable' }
  if ((Get-FileHash $binary).Hash -ne (Get-FileHash $hello.build).Hash) { throw 'Host does not match installed build' }
  $snapshot = & $probe snapshot $root | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $snapshot.accounts.Count -ne 0) { throw 'Empty-profile snapshot failed' }
  if (!$app.CloseMainWindow() -or !$app.WaitForExit(10000)) { throw 'App did not close normally' }
  & $probe hello $root
  if ($LASTEXITCODE -ne 0) { throw 'Background host did not survive GUI exit' }
  $app = Start-Process $binary -PassThru
  Start-Sleep -Seconds 3
  $app.Refresh()
  if ($app.HasExited -or $app.MainWindowHandle -eq 0) { throw 'App failed to reopen' }
  $reopened = & $probe hello $root | ConvertFrom-Json
  if ($reopened.build -ne $hello.build) { throw 'Reopened app attached to another build' }
  if (!$app.CloseMainWindow() -or !$app.WaitForExit(10000)) { throw 'Reopened app did not close normally' }
  & $probe upgrade_idle $root
  if ($LASTEXITCODE -ne 0) { throw 'Test host could not shut down' }
  Start-Sleep -Seconds 1
  Write-Output 'PASS: NSIS install, visible native window, matching host, empty snapshot, GUI exit and reopen'
} finally {
  if ($app -and !$app.HasExited) { Stop-Process -Id $app.Id }
  if ($root -and (Test-Path $root)) { & $probe upgrade_idle $root 2>$null }
  foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $debugArgs
}
