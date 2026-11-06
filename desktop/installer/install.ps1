<#
  Muse4AI — per-user installer (R22) / trình cài theo người dùng. No admin rights, ExecutionPolicy untouched.
  Installs into %LOCALAPPDATA%\Programs\Muse4AI\app-<version> and keeps one previous version for rollback.
  NEVER touches data (%APPDATA%\MuseStudio, %LOCALAPPDATA%\MuseStudio) or the library folder.

  Run (inside the extracted folder):
    powershell -ExecutionPolicy Bypass -File .\install.ps1
  Roll back to the previous version (also works from <install folder>\tools, without the ZIP):
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Rollback
  Messages follow -Lang en|vi; without it, the app's saved language (ui-locale), else English.
  Build 3.3: every install keeps a verified copy of install.ps1 + uninstall.ps1 in <install folder>\tools and lists
  Muse4AI in Windows Settings › Apps (per user, HKCU) so EXE users can uninstall or roll back without the ZIP.
  -Gui shows failures in a message box (hidden runs started by the app or the uninstall window).
  Isolated lab only: MUSE4AI_TEST=1 + MUSE4AI_DATA redirect data, shortcuts and the Apps entry's data paths to that folder.
#>
[CmdletBinding()]
param(
  [switch]$Rollback,
  [string]$Target = '',
  [switch]$NoLaunch,
  [switch]$Gui,
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
$InstallRoot = $InstallRoot.TrimEnd('\')
$defaultRoot = Join-Path $env:LOCALAPPDATA 'Programs\Muse4AI'

# Isolated lab (never set on a user's machine): data, shortcuts and the Apps entry point into MUSE4AI_DATA.
$labData = if ($env:MUSE4AI_TEST -eq '1' -and $env:MUSE4AI_DATA) { $env:MUSE4AI_DATA.TrimEnd('\') } else { '' }
$roamingDir = if ($labData) { Join-Path $labData 'roaming' } else { Join-Path $env:APPDATA 'MuseStudio' }

# R120/R124: the same language as the app. An explicit -Lang (the EXE's language page) also becomes the app's first
# language when the app has none saved yet; without -Lang, use the app's saved language, else English (the default).
$localeFile = Join-Path $roamingDir 'ui-locale'
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
  # Hidden runs started by the app (rollback) or the uninstall window have no console: show the reason.
  if ($Gui) {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      [void][System.Windows.Forms.MessageBox]::Show($msg, 'Muse4AI', 'OK', 'Warning')
    } catch {}
  }
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

function Get-ShortcutPaths {
  if ($labData) { return @((Join-Path $labData 'shortcuts\Start Menu\Muse4AI.lnk'), (Join-Path $labData 'shortcuts\Desktop\Muse4AI.lnk')) }
  return @((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Muse4AI.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Muse4AI.lnk'))
}

function Register-Shortcuts([string]$exe) {
  # The app's own writer sets the AppUserModelID + toast activator CLSID that Windows notifications need. A lab run
  # skips it: that writer always targets the real Start Menu and Desktop.
  if (-not $labData) {
    $result = Join-Path $env:TEMP 'muse4ai-shortcuts.json'
    Remove-Item $result -ErrorAction SilentlyContinue
    $proc = Start-Process -FilePath $exe -ArgumentList '--register-shortcuts' -PassThru -WindowStyle Hidden
    if (-not $proc.WaitForExit(30000)) { try { $proc.Kill() } catch {} }
  }
  # Safety net: if the app's writer did not produce a link pointing at this version, write a plain one here.
  $startMenu, $desktop = Get-ShortcutPaths
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

# Same function, same text in uninstall.ps1 (checked by desktop/test/installer-scripts.test.ts).
function Get-UninstallKeyName {
  if ($InstallRoot.TrimEnd('\') -ieq $defaultRoot.TrimEnd('\')) { return 'Muse4AI' }
  $sha = [Security.Cryptography.SHA256]::Create()
  $hex = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($InstallRoot.TrimEnd('\').ToLowerInvariant())) | Select-Object -First 4 | ForEach-Object { $_.ToString('x2') })
  return "Muse4AI-$hex"
}

function Save-Tools {
  # AC-UNI-02: keep the verified scripts so uninstall and rollback work without the ZIP (EXE users never see it).
  $tools = Join-Path $InstallRoot 'tools'
  if ($here.TrimEnd('\') -ieq $tools) { return }
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  foreach ($name in @('install.ps1', 'uninstall.ps1')) {
    $tmp = Join-Path $tools ".$name.new"
    Copy-Item -Path (Join-Path $here $name) -Destination $tmp -Force
    Move-Item -Path $tmp -Destination (Join-Path $tools $name) -Force
  }
}

function Register-Uninstall([string]$version) {
  # AC-UNI-01: Windows Settings › Apps entry for this user (no admin rights). Only an Uninstall button (no Modify/Repair).
  $uninstaller = Join-Path $InstallRoot 'tools\uninstall.ps1'
  if (-not (Test-Path $uninstaller)) { return }
  $appDir = Join-Path $InstallRoot "app-$version"
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $extra = ''
  if ($InstallRoot -ine $defaultRoot) { $extra += " -InstallRoot `"$InstallRoot`"" }
  if ($labData) { $extra += " -LabData `"$labData`"" }
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$(Get-UninstallKeyName)"
  $kb = 0
  try { $kb = [int][Math]::Ceiling(((Get-ChildItem -Path $appDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum) / 1KB) } catch {}
  New-Item -Path $key -Force | Out-Null
  $name = if ($InstallRoot -ieq $defaultRoot) { 'Muse4AI' } else { "Muse4AI ($InstallRoot)" }
  $values = [ordered]@{
    DisplayName          = $name
    DisplayVersion       = $version
    Publisher            = 'Andrew Babo'
    DisplayIcon          = "$(Join-Path $appDir 'Muse4AI.exe'),0"
    InstallLocation      = $InstallRoot
    InstallDate          = (Get-Date).ToString('yyyyMMdd')
    UninstallString      = "`"$ps`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$uninstaller`" -Gui$extra"
    QuietUninstallString = "`"$ps`" -NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`"$extra"
    URLInfoAbout         = 'https://muse4ai.andrewbabo.com'
    URLUpdateInfo        = 'https://muse4ai.andrewbabo.com/download'
    HelpLink             = 'https://github.com/andrew-babo/muse4ai/issues'
  }
  foreach ($k in $values.Keys) { New-ItemProperty -Path $key -Name $k -Value $values[$k] -PropertyType String -Force | Out-Null }
  foreach ($k in @('NoModify', 'NoRepair')) { New-ItemProperty -Path $key -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
  New-ItemProperty -Path $key -Name 'EstimatedSize' -Value $kb -PropertyType DWord -Force | Out-Null
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
  $prev = if ($Target) { $versions | Where-Object { $_.Name -eq "app-$Target" } | Select-Object -First 1 } else { $versions | Where-Object { $_.Name -ne "app-$current" } | Select-Object -First 1 }
  if (-not $prev) { Fail (T 'There is no previous version to roll back to.' 'Không có bản trước để quay lại.') }
  Say (T 'Note: data written after the upgrade may be missing in the older version. Data backups are in %APPDATA%\MuseStudio\backups.' 'Lưu ý: dữ liệu ghi sau lần nâng cấp có thể không có trong bản cũ. Bản sao lưu dữ liệu nằm trong %APPDATA%\MuseStudio\backups.') 'Yellow'
  $ver = $prev.Name.Substring(4)
  Register-Shortcuts (Join-Path $prev.FullName 'Muse4AI.exe')
  Write-Current $ver
  try { Register-Uninstall $ver } catch { Say ((T 'Windows Apps entry not updated: {0}' 'Chưa cập nhật được mục trong Ứng dụng của Windows: {0}') -f $_.Exception.Message) 'Yellow' }
  # The rolled-back version keeps its folder date fresh, so the next -Rollback finds the newer one as "previous".
  try { (Get-Item $prev.FullName).LastWriteTime = Get-Date } catch {}
  Say ((T 'Now using version {0}.' 'Đã chuyển sang bản {0}.') -f $ver) 'Green'
  if (-not $NoLaunch) { Start-Process -FilePath (Join-Path $prev.FullName 'Muse4AI.exe') }
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
# The app is installed at this point; a failure below only costs the Apps entry, never the install.
try { Save-Tools; Register-Uninstall $version } catch { Say ((T 'Windows Apps entry not added: {0}' 'Chưa thêm được mục trong Ứng dụng của Windows: {0}') -f $_.Exception.Message) 'Yellow' }

Say ''
Say ((T 'Installed Muse4AI {0} in {1}' 'Đã cài Muse4AI {0} vào {1}') -f $version, $target) 'Green'
Say (T 'Shortcuts are on the Start Menu and Desktop. Your data and library are kept.' 'Có lối tắt ở Start Menu và Desktop. Dữ liệu và thư viện của anh được giữ nguyên.') 'Gray'
if (-not $NoLaunch) { Start-Process -FilePath (Join-Path $target 'Muse4AI.exe') }
exit 0
