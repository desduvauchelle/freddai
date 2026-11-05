$ErrorActionPreference = 'Stop'
$probe = (Resolve-Path 'target/debug/examples/host_probe.exe').Path
$root = Join-Path $env:TEMP ('freddai-host-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
# Exercise a response larger than a named-pipe buffer without creating any account or agent turn.
$largeName = 'x' * 200000
@{
  accounts = @(); sessions = @(); preferences = @{ prefer_last = $true; fallback = $null; last = $null }
  projects = @(@{ id = 'fixture'; name = $largeName; path = $root; color = 'blue'; policy = 'p'; account = $null; last = $null })
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM (Join-Path $root 'workspace.json')
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
  if ($snapshot.projects[0].name.Length -ne $largeName.Length) { throw 'Large snapshot was truncated' }
  & $probe upgrade_idle $root
  if ($LASTEXITCODE -ne 0 -or !$hostProcess.WaitForExit(10000)) { throw 'Idle upgrade failed' }
  $hostProcess = Start-Process $probe -ArgumentList @('--host', ('"' + $root + '"')) -PassThru
  Start-Sleep -Seconds 1
  $recovered = & $probe snapshot $root | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $recovered.projects[0].name.Length -ne $largeName.Length) { throw 'Host did not recover persisted data after restart' }
  & $probe upgrade_idle $root
  if (!$hostProcess.WaitForExit(10000)) { throw 'Host did not exit' }
  Write-Output 'PASS: Windows host handshake, large account-free snapshot, idle shutdown, persisted restart'
} finally {
  if ($hostProcess -and !$hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id }
  Remove-Item -Recurse -Force $root
}
