<#
  Muse4AI — per-user installer (R22) / trình cài theo người dùng. No admin rights, ExecutionPolicy untouched.
  Installs into %LOCALAPPDATA%\Programs\Muse4AI\app-<version> and keeps one previous version for rollback.
  NEVER touches data (%APPDATA%\MuseStudio, %LOCALAPPDATA%\MuseStudio) or the library folder.

  Run (inside the extracted folder):
    powershell -ExecutionPolicy Bypass -File .\install.ps1
  Roll back to the previous version:
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Rollback
  Messages follow -Lang en|vi; without it, the app's saved language (ui-locale), else English.
#>
[CmdletBinding()]
param(
  [switch]$Rollback,
  [switch]$NoLaunch,
  [switch]$CloseRunning,
  [string]$ResultFile = '',
  [ValidateSet('', 'en', 'vi')]
  [string]$Lang = '',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Muse4AI')
)

# Launched from PowerShell 7 (or an EXE started from it), Windows PowerShell inherits a module path without its
# own modules, so Get-FileHash / Get-CimInstance would be missing. Use Windows PowerShell's standard module path.
if ($PSVersionTable.PSVersion.Major -le 5) {
  $env:PSModulePath = @((Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'WindowsPowerShell\Modules'), (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'), (Join-Path $PSHOME 'Modules')) -join ';'
}
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 2.0
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# R120/R124: the same language as the app. An explicit -Lang (the EXE's language page) also becomes the app's first
# language when the app has none saved yet; without -Lang, use the app's saved language, else English (the default).
$localeFile = Join-Path $env:APPDATA 'MuseStudio\ui-locale'
$savedLang = ''
if (Test-Path $localeFile) {
  try { $savedLang = (Get-Content $localeFile -Raw -ErrorAction Stop).Trim() } catch { $savedLang = '' }
  if ($savedLang -ne 'en' -and $savedLang -ne 'vi') { $savedLang = '' }
}
$explicitLang = [bool]$Lang
if (-not $Lang) { $Lang = if ($savedLang) { $savedLang } else { 'en' } }
function T([string]$en, [string]$vi) { if ($Lang -eq 'vi') { return $vi } else { return $en } }

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Fail([string]$msg) {
  Write-Host ''; Write-Host $msg -ForegroundColor Red
  # The EXE runs this script hidden; it reads this file to show the real reason instead of a generic error.
  if ($ResultFile) { try { [IO.File]::WriteAllText($ResultFile, $msg, (New-Object Text.UTF8Encoding($true))) } catch {} }
  exit 1
}

# Any error not handled below still reaches the EXE's dialog with its real reason (never a silent exit).
trap { Fail ((T 'Setup stopped: {0}' 'Cài đặt dừng lại: {0}') -f $_.Exception.Message) }

function Test-AppRunning {
  # Win32_Process sees the app in every Windows session (an RDP desktop while this runs over SSH or as another
  # logon); Get-Process returns no Path for those, which once let an install proceed over a running app.
  $procs = @(Get-CimInstance -ClassName Win32_Process -Filter "Name='Muse4AI.exe'" -ErrorAction SilentlyContinue)
  foreach ($p in $procs) {
    # A path we cannot read is treated as running: never install over a possibly running copy.
    if (-not $p.ExecutablePath) { return $true }
    if ($p.ExecutablePath.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Get-InstalledVersions {
  if (-not (Test-Path $InstallRoot)) { return @() }
  # Only complete versions: never a leftover backup (app-<v>.bak-xxxx) from an interrupted install.
  return @(Get-ChildItem -Path $InstallRoot -Directory -Filter 'app-*' |
    Where-Object { $_.Name -notmatch '\.bak-' -and (Test-Path (Join-Path $_.FullName 'Muse4AI.exe')) } |
    Sort-Object LastWriteTime -Descending)
}

function Register-Shortcuts([string]$exe) {
  $result = Join-Path $env:TEMP 'muse4ai-shortcuts.json'
  Remove-Item $result -ErrorAction SilentlyContinue
  $proc = Start-Process -FilePath $exe -ArgumentList '--register-shortcuts' -PassThru -WindowStyle Hidden
  if (-not $proc.WaitForExit(30000)) { try { $proc.Kill() } catch {} }
  # Safety net: if the app's writer did not produce a link pointing at this version, write a plain one here.
  # The app's own writer also sets the AppUserModelID + toast activator CLSID that Windows notifications need.
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Muse4AI.lnk'
  $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Muse4AI.lnk'
  $icon = Join-Path (Split-Path -Parent $exe) 'resources\icon.ico'
  $wsh = New-Object -ComObject WScript.Shell
  foreach ($lnk in @($startMenu, $desktop)) {
    $l = $wsh.CreateShortcut($lnk)
    if ((Test-Path $lnk) -and $l.TargetPath -eq $exe) { continue }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lnk) | Out-Null
    $l.TargetPath = $exe
    $l.WorkingDirectory = Split-Path -Parent $exe
    if (Test-Path $icon) { $l.IconLocation = "$icon,0" }
    $l.Description = 'Muse4AI'
    $l.Save()
  }
  if (-not (Test-Path $startMenu)) { throw (T 'Could not create the Start Menu shortcut' 'Không tạo được lối tắt Start Menu') }
}

function Write-Current([string]$version) {
  Set-Content -Path (Join-Path $InstallRoot 'current.txt') -Value $version -Encoding ASCII
}

function Write-FirstLanguage {
  # Only a language picked in the EXE, and only when the app has never saved one: an in-app choice always wins.
  if (-not $explicitLang -or $savedLang) { return }
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $localeFile) | Out-Null
    [IO.File]::WriteAllText($localeFile, $Lang)
  } catch { Say (T 'Could not save the language choice (skipped).' 'Không lưu được lựa chọn ngôn ngữ (bỏ qua).') 'Yellow' }
}

Say (T 'Muse4AI — setup' 'Muse4AI — cài đặt') 'White'
if ((Test-AppRunning) -and $CloseRunning) {
  # Ask the running copy to quit the normal way (same as tray → Quit), so its data is saved; never force-kill.
  Say (T 'Closing Muse4AI…' 'Đang đóng Muse4AI…')
  $exes = @(Get-CimInstance -ClassName Win32_Process -Filter "Name='Muse4AI.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object { $_.ExecutablePath } |
    Where-Object { $_ -and $_.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase) })
  $exes += @(Get-InstalledVersions | ForEach-Object { Join-Path $_.FullName 'Muse4AI.exe' })
  foreach ($e in ($exes | Select-Object -Unique)) {
    if (Test-Path $e) { try { Start-Process -FilePath $e -ArgumentList '--quit' -WindowStyle Hidden } catch {} }
    break
  }
  $deadline = (Get-Date).AddSeconds(45)
  while ((Test-AppRunning) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Seconds 1
}
if (Test-AppRunning) { Fail (T 'Quit Muse4AI first (right-click the tray icon → Quit), then run the installer again.' 'Hãy thoát Muse4AI trước (chuột phải biểu tượng dưới khay → Thoát), rồi chạy lại lệnh cài.') }

# An earlier install that was interrupted (window closed, power cut) can leave a staging folder behind; nothing
# uses it once we get here, so clear it before starting.
if (Test-Path $InstallRoot) {
  Get-ChildItem -Path $InstallRoot -Directory -Filter '.staging-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- rollback
if ($Rollback) {
  $versions = Get-InstalledVersions
  $current = if (Test-Path (Join-Path $InstallRoot 'current.txt')) { (Get-Content (Join-Path $InstallRoot 'current.txt') -Raw).Trim() } else { '' }
  $prev = $versions | Where-Object { $_.Name -ne "app-$current" } | Select-Object -First 1
  if (-not $prev) { Fail (T 'There is no previous version to roll back to.' 'Không có bản trước để quay lại.') }
  Say (T 'Note: data written after the upgrade may be missing in the older version. Data backups are in %APPDATA%\MuseStudio\backups.' 'Lưu ý: dữ liệu ghi sau lần nâng cấp có thể không có trong bản cũ. Bản sao lưu dữ liệu nằm trong %APPDATA%\MuseStudio\backups.') 'Yellow'
  $ver = $prev.Name.Substring(4)
  Register-Shortcuts (Join-Path $prev.FullName 'Muse4AI.exe')
  Write-Current $ver
  Say ((T 'Rolled back to version {0}.' 'Đã quay lại bản {0}.') -f $ver) 'Green'
  exit 0
}

# ---------------------------------------------------------------- verify package (SHA-256)
$sumsFile = Join-Path $here 'SHA256SUMS.txt'
if (-not (Test-Path $sumsFile)) { Fail (T 'The package is missing SHA256SUMS.txt.' 'Gói cài thiếu tệp SHA256SUMS.txt.') }
$expected = @{}
foreach ($line in Get-Content $sumsFile) {
  if ($line -match '^([0-9A-Fa-f]{64})\s+(.+)$') { $expected[$Matches[2].Trim()] = $Matches[1].ToUpper() }
}
foreach ($name in @('app.zip', 'install.ps1', 'uninstall.ps1', 'version.txt')) {
  $f = Join-Path $here $name
  if (-not (Test-Path $f) -or -not $expected.ContainsKey($name)) { Fail ((T 'The package does not match its checksums ({0} is missing).' 'Gói cài không khớp mã kiểm tra (thiếu {0}).') -f $name) }
  $actual = (Get-FileHash -Path $f -Algorithm SHA256).Hash.ToUpper()
  if ($actual -ne $expected[$name]) { Fail ((T 'The package does not match its checksums ({0}). Download it again.' 'Gói cài không khớp mã kiểm tra ({0}). Hãy tải lại gói.') -f $name) }
}
$version = (Get-Content (Join-Path $here 'version.txt') -Raw).Trim()
if ($version -notmatch '^[0-9A-Za-z.\-]+$') { Fail (T 'The version in the package is not valid.' 'Phiên bản trong gói không hợp lệ.') }
Say ((T 'Package verified — version {0}' 'Gói hợp lệ — phiên bản {0}') -f $version) 'Green'

# ---------------------------------------------------------------- install
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$target = Join-Path $InstallRoot "app-$version"
$staging = Join-Path $InstallRoot ".staging-$version-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$backup = $null
$prevCurrent = if (Test-Path (Join-Path $InstallRoot 'current.txt')) { (Get-Content (Join-Path $InstallRoot 'current.txt') -Raw).Trim() } else { '' }
try {
  Say (T 'Extracting…' 'Đang giải nén…')
  # .NET extraction: much faster than Expand-Archive on Windows PowerShell 5.1 for the ~1,000 files of the app.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $here 'app.zip'), $staging)
  if (-not (Test-Path (Join-Path $staging 'Muse4AI.exe'))) { throw (T 'The package has no Muse4AI.exe' 'Gói thiếu Muse4AI.exe') }
  if (Test-Path $target) {
    $backup = "$target.bak-$([guid]::NewGuid().ToString('N').Substring(0,6))"
    Move-Item -Path $target -Destination $backup
  }
  Move-Item -Path $staging -Destination $target
  Register-Shortcuts (Join-Path $target 'Muse4AI.exe')
  Write-Current $version
  if ($backup) { Remove-Item -Recurse -Force $backup }
} catch {
  $installError = $_.Exception.Message
  Say ((T 'Install error: {0}. Restoring…' 'Cài lỗi: {0}. Đang khôi phục…') -f $_.Exception.Message) 'Yellow'
  if (Test-Path $staging) { Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue }
  if ($backup -and (Test-Path $backup)) {
    if (Test-Path $target) { Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue }
    Move-Item -Path $backup -Destination $target
  } elseif ((Test-Path $target) -and ($prevCurrent -ne $version)) {
    Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
  }
  if ($prevCurrent) {
    $prevExe = Join-Path $InstallRoot "app-$prevCurrent\Muse4AI.exe"
    if (Test-Path $prevExe) { try { Register-Shortcuts $prevExe } catch {} }
  }
  Fail ((T 'Installation failed: {0}. The previous version (if any) is unchanged.' 'Không cài được: {0}. Bản cũ (nếu có) vẫn giữ nguyên.') -f $installError)
}

# Keep exactly one previous version (R22).
$keepPrev = Get-InstalledVersions | Where-Object { $_.Name -ne "app-$version" } | Select-Object -First 1
foreach ($d in (Get-InstalledVersions | Where-Object { $_.Name -ne "app-$version" -and (-not $keepPrev -or $_.FullName -ne $keepPrev.FullName) })) {
  try { Remove-Item -Recurse -Force $d.FullName } catch { Say ((T 'Could not remove old version {0} (skipped).' 'Không xoá được bản cũ {0} (bỏ qua).') -f $d.Name) 'Yellow' }
}
Get-ChildItem -Path $InstallRoot -Directory -Filter '.staging-*' -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
Write-FirstLanguage

Say ''
Say ((T 'Installed Muse4AI {0} in {1}' 'Đã cài Muse4AI {0} vào {1}') -f $version, $target) 'Green'
Say (T 'Shortcuts are on the Start Menu and Desktop. Your data and library are kept.' 'Có lối tắt ở Start Menu và Desktop. Dữ liệu và thư viện của anh được giữ nguyên.') 'Gray'
if (-not $NoLaunch) { Start-Process -FilePath (Join-Path $target 'Muse4AI.exe') }
exit 0
