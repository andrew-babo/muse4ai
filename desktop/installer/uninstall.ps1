<#
  Muse4AI — uninstall / gỡ cài (R22).
  Default: removes the app and shortcuts, KEEPS data and the library.
  -RemoveData: also removes app data (%APPDATA%\MuseStudio, %LOCALAPPDATA%\MuseStudio) but NEVER the image/video library.
  Messages follow -Lang en|vi; without it, the app's saved language (ui-locale), else English.

    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveData
#>
[CmdletBinding()]
param(
  [switch]$RemoveData,
  [ValidateSet('', 'en', 'vi')]
  [string]$Lang = '',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Muse4AI')
)
$ErrorActionPreference = 'Stop'

if (-not $Lang) {
  $localeFile = Join-Path $env:APPDATA 'MuseStudio\ui-locale'
  $saved = if (Test-Path $localeFile) { try { (Get-Content $localeFile -Raw -ErrorAction Stop).Trim() } catch { '' } } else { '' }
  $Lang = if ($saved -eq 'vi') { 'vi' } else { 'en' }
}
function T([string]$en, [string]$vi) { if ($Lang -eq 'vi') { return $vi } else { return $en } }
function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }

# Win32_Process sees the app in every Windows session; an unreadable path counts as running.
$running = @(Get-CimInstance -ClassName Win32_Process -Filter "Name='Muse4AI.exe'" -ErrorAction SilentlyContinue |
  Where-Object { -not $_.ExecutablePath -or $_.ExecutablePath.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase) })
if ($running.Count) { Say (T 'Quit Muse4AI first (right-click the tray icon → Quit).' 'Hãy thoát Muse4AI trước (chuột phải biểu tượng dưới khay → Thoát).') 'Red'; exit 1 }

# A crash can leave the app's own HTTPS (Caddy) or tunnel (cloudflared) helper running. Stop only copies whose
# executable sits in the app's own bin folder — never another program's cloudflared/caddy.
$helperBin = Join-Path $env:LOCALAPPDATA 'MuseStudio\bin'
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { ($_.Name -like 'caddy*' -or $_.Name -like 'cloudflared*') -and $_.Path -and $_.Path.StartsWith($helperBin + '\', [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Say ((T 'Stopped a leftover helper of the app: {0}' 'Đã dừng chương trình phụ còn sót của app: {0}') -f $_.Name) 'Gray' } catch {} }

$current = if (Test-Path (Join-Path $InstallRoot 'current.txt')) { (Get-Content (Join-Path $InstallRoot 'current.txt') -Raw).Trim() } else { '' }
$exe = if ($current) { Join-Path $InstallRoot "app-$current\Muse4AI.exe" } else { '' }
if ($exe -and (Test-Path $exe)) {
  $p = Start-Process -FilePath $exe -ArgumentList '--unregister-shortcuts' -PassThru -WindowStyle Hidden
  [void]$p.WaitForExit(30000)
}
foreach ($lnk in @((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Muse4AI.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Muse4AI.lnk'))) {
  if (Test-Path $lnk) { Remove-Item -Force $lnk }
}
# Remove the "start with Windows" entry if the app set one.
try { Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'electron.app.MuseStudio' -ErrorAction SilentlyContinue } catch {}
try { Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'MuseStudio' -ErrorAction SilentlyContinue } catch {}

if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot }
Say (T 'Muse4AI has been uninstalled.' 'Đã gỡ Muse4AI.') 'Green'

if ($RemoveData) {
  # The library folder is never inside these two folders (default: Pictures\Muse4AI), so it stays untouched.
  foreach ($d in @((Join-Path $env:APPDATA 'MuseStudio'), (Join-Path $env:LOCALAPPDATA 'MuseStudio'))) {
    if (Test-Path $d) { Remove-Item -Recurse -Force $d }
  }
  Say (T 'App data removed. The image/video library folder is kept.' 'Đã xoá dữ liệu app. Thư mục thư viện ảnh/video vẫn giữ nguyên.') 'Green'
} else {
  Say (T 'Data (%APPDATA%\MuseStudio) and the library are kept.' 'Dữ liệu (%APPDATA%\MuseStudio) và thư viện vẫn giữ nguyên.') 'Gray'
}
exit 0
