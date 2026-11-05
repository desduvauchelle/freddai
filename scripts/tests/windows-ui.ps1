param([long]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force 'output/windows-validation' | Out-Null
$window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
$deadline = [DateTime]::UtcNow.AddSeconds(60)
$names = @()
$buttons = @()
do {
  $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $names = @($elements | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
  $buttons = @($elements | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
  if (($names -contains 'Set up agents & accounts') -and ($names -contains 'Scan again') -and $buttons.Count -gt 3) { break }
  Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)
@{ names = $names; buttons = @($buttons | ForEach-Object { $_.Current.Name }) } | ConvertTo-Json -Depth 4 | Set-Content 'output/windows-validation/ui.json'
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save((Join-Path (Get-Location) 'output/windows-validation/app.png'))
$graphics.Dispose()
$bitmap.Dispose()
if (!($names -contains 'Set up agents & accounts') -or !($names -contains 'Scan again') -or $buttons.Count -le 3) { throw 'Installed workspace controls did not appear in Windows UI Automation; see ui.json and app.png' }
if (($names -join "`n") -match 'Background host (exited|did not start)|host is unavailable') { throw 'Workspace reports a host failure' }
Write-Output 'PASS: installed WebView2 rendered account setup and accessible controls'
