$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run this installation test on a disposable GitHub Actions Windows runner.' }
$nativeRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.freddai.desktop'
if (Test-Path $nativeRoot) { throw 'Refusing to test against an existing Freddai workspace.' }
$installer = (Get-ChildItem 'target/release/bundle/nsis/*.exe' | Select-Object -First 1).FullName
$probe = (Resolve-Path 'target/debug/examples/host_probe.exe').Path
$fixture = Join-Path $env:TEMP ('freddai-install-test-' + [guid]::NewGuid())
$install = Join-Path $fixture 'app'
function Close-TestApp($process) {
  $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$process.Id)
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
  $window = $windows | Where-Object { $_.Current.Name -eq 'Freddai' } | Select-Object -First 1
  if (!$window) { throw 'Visible Freddai window missing before normal close' }
  $pattern = $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
  $pattern.Close()
  if (!$process.WaitForExit(10000)) { throw 'App did not exit after normal window close' }
}
$app = $null
$root = $nativeRoot
try {
  # The disposable runner has no Freddai profile. Preserve Windows' real known
  # folders so WebView2 can discover its installed runtime and initialize normally.
  New-Item -ItemType Directory -Force 'output/windows-validation' | Out-Null
  $setup = Start-Process $installer -ArgumentList @('/S', ('/D=' + $install)) -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
  $binary = Join-Path $install 'freddai-native.exe'
  if (!(Test-Path $binary)) { throw 'Installed executable missing' }
  $app = Start-Process $binary -PassThru -RedirectStandardError 'output/windows-validation/native-stderr.log' -RedirectStandardOutput 'output/windows-validation/native-stdout.log'
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $app.Refresh()
    if ($app.HasExited) { throw "App exited during startup: $($app.ExitCode)" }
    if ($app.MainWindowHandle -ne 0) { break }
  }
  if ($app.MainWindowHandle -eq 0) { throw 'No native app window appeared' }
  ./scripts/tests/windows-ui.ps1 -AppProcessId $app.Id
  $root = $nativeRoot
  $hello = & $probe hello $root | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Installed host handshake failed' }
  if (!(Test-Path $hello.build) -or !($hello.build.EndsWith('.exe'))) { throw 'Host is not using the cached Windows executable' }
  if ((Get-FileHash $binary).Hash -ne (Get-FileHash $hello.build).Hash) { throw 'Host does not match installed build' }
  $snapshot = & $probe snapshot $root | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $snapshot.accounts.Count -ne 0) { throw 'Empty-profile snapshot failed' }
  Close-TestApp $app
  & $probe hello $root
  if ($LASTEXITCODE -ne 0) { throw 'Background host did not survive GUI exit' }
  $app = Start-Process $binary -PassThru
  Start-Sleep -Seconds 3
  $app.Refresh()
  if ($app.HasExited -or $app.MainWindowHandle -eq 0) { throw 'App failed to reopen' }
  $reopened = & $probe hello $root | ConvertFrom-Json
  if ($reopened.build -ne $hello.build) { throw 'Reopened app attached to another build' }
  ./scripts/tests/windows-ui.ps1 -AppProcessId $app.Id
  Close-TestApp $app
  & $probe upgrade_idle $root
  if ($LASTEXITCODE -ne 0) { throw 'Test host could not shut down' }
  $root = $null # Shutdown succeeded; do not turn a second cleanup RPC into a failure.
  Start-Sleep -Seconds 1
  Write-Output 'PASS: NSIS install, visible native window, matching host, empty snapshot, GUI exit and reopen'
} finally {
  New-Item -ItemType Directory -Force 'output/windows-validation' | Out-Null
  if ($app) { $app.Refresh(); Write-Output "App exited=$($app.HasExited) exitCode=$($app.ExitCode)" }
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'freddai|msedgewebview' } | Select-Object Name, ProcessId, ParentProcessId, CommandLine | ConvertTo-Json -Depth 4 | Set-Content 'output/windows-validation/processes.json'
  if (Test-Path (Join-Path $nativeRoot 'host.log')) { Copy-Item (Join-Path $nativeRoot 'host.log') 'output/windows-validation/host.log' }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save((Join-Path (Get-Location) 'output/windows-validation/desktop.png'))
  $graphics.Dispose()
  $bitmap.Dispose()
  if ($app -and !$app.HasExited) { Stop-Process -Id $app.Id }
  if ($root -and (Test-Path $root)) { & $probe upgrade_idle $root 2>$null }
}
