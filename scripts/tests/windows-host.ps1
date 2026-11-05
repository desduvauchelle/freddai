$ErrorActionPreference = 'Stop'
$probe = (Resolve-Path 'target/debug/examples/host_probe.exe').Path
$root = Join-Path $env:TEMP ('freddai-host-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
$hostProcess = $null
try {
  $hostProcess = Start-Process $probe -ArgumentList @('--host', ('"' + $root + '"')) -PassThru -RedirectStandardError (Join-Path $root 'host.log')
  $ready = $false
  for ($i = 0; $i -lt 100; $i++) {
    $hello = & $probe hello $root 2>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    if ($hostProcess.HasExited) { throw "Host exited: $(Get-Content (Join-Path $root 'host.log') -Raw)" }
    Start-Sleep -Milliseconds 100
  }
  if (!$ready) { throw 'Host never became ready' }
  if (!(($hello | ConvertFrom-Json).version)) { throw 'Missing handshake version' }
  $snapshot = & $probe snapshot $root | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $snapshot.accounts.Count -ne 0 -or $snapshot.sessions.Count -ne 0) { throw 'Expected an empty workspace' }
  & $probe upgrade_idle $root
  if ($LASTEXITCODE -ne 0 -or !$hostProcess.WaitForExit(10000)) { throw 'Idle upgrade failed' }
  $hostProcess = Start-Process $probe -ArgumentList @('--host', ('"' + $root + '"')) -PassThru
  Start-Sleep -Seconds 1
  & $probe snapshot $root
  if ($LASTEXITCODE -ne 0) { throw 'Host did not recover after restart' }
  & $probe upgrade_idle $root
  if (!$hostProcess.WaitForExit(10000)) { throw 'Host did not exit' }
  Write-Output 'PASS: Windows host handshake, empty snapshot, idle shutdown, persisted restart'
} finally {
  if ($hostProcess -and !$hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id }
  Remove-Item -Recurse -Force $root
}
