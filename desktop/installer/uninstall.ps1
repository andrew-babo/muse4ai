<#
  Muse4AI — uninstall / gỡ cài (R22, Build 3.3 AC-UNI-01…05).
  Default: removes the app and its shortcuts, KEEPS data and the library.
  -RemoveData: also removes app data (%APPDATA%\MuseStudio, %LOCALAPPDATA%\MuseStudio) but NEVER the image/video library.
  -Gui: the window Windows Settings › Apps opens (bilingual): keep or remove data, or go back to the kept previous
        version instead; asks a running app to quit the normal way first.
  Messages follow -Lang en|vi; without it, the app's saved language (ui-locale), else English.
  Only things that point into this install folder are touched (shortcuts, the start-with-Windows entry, its Apps entry).

    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveData
#>
[CmdletBinding()]
param(
  [switch]$RemoveData,
  [switch]$Gui,
  [ValidateSet('', 'en', 'vi')]
  [string]$Lang = '',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Muse4AI'),
  # Isolated lab only: the data folder of a test install (same layout as MUSE4AI_DATA).
  [string]$LabData = ''
)
# Launched from PowerShell 7 (or an EXE started from it), Windows PowerShell inherits a module path without its
# own modules, so Get-FileHash / Get-CimInstance would be missing. Use Windows PowerShell's standard module path.
if ($PSVersionTable.PSVersion.Major -le 5) {
  $env:PSModulePath = @((Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'WindowsPowerShell\Modules'), (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'), (Join-Path $PSHOME 'Modules')) -join ';'
}
$ErrorActionPreference = 'Stop'
# This script may live inside the folder it removes (<install folder>\tools): never hold it as the working folder.
Set-Location -Path $env:TEMP
[Environment]::CurrentDirectory = $env:TEMP

$InstallRoot = $InstallRoot.TrimEnd('\')
$defaultRoot = Join-Path $env:LOCALAPPDATA 'Programs\Muse4AI'
if (-not $LabData -and $env:MUSE4AI_TEST -eq '1' -and $env:MUSE4AI_DATA) { $LabData = $env:MUSE4AI_DATA }
$LabData = $LabData.TrimEnd('\')
if ($LabData) {
  # Children (`Muse4AI.exe --quit`, the rollback) must reach the lab copy: without these the app's single-instance
  # lock is the standard data folder's, and --quit would be handed to the user's real copy.
  $env:MUSE4AI_TEST = '1'
  $env:MUSE4AI_DATA = $LabData
}
$roamingDir = if ($LabData) { Join-Path $LabData 'roaming' } else { Join-Path $env:APPDATA 'MuseStudio' }
$localDir = if ($LabData) { Join-Path $LabData 'local' } else { Join-Path $env:LOCALAPPDATA 'MuseStudio' }
# AC-UNI-05: data is removed only for the standard install (or a lab); an install elsewhere never deletes the
# standard data folders another copy may be using.
$canRemoveData = [bool]$LabData -or ($InstallRoot -ieq $defaultRoot)

if (-not $Lang) {
  $localeFile = Join-Path $roamingDir 'ui-locale'
  $saved = if (Test-Path $localeFile) { try { (Get-Content $localeFile -Raw -ErrorAction Stop).Trim() } catch { '' } } else { '' }
  $Lang = if ($saved -eq 'vi') { 'vi' } else { 'en' }
}
function T([string]$en, [string]$vi) { if ($Lang -eq 'vi') { return $vi } else { return $en } }
function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }

if ($Gui) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
}
function Show-Message([string]$text, [string]$icon = 'Information') {
  if ($Gui) { [void][System.Windows.Forms.MessageBox]::Show($text, (T 'Uninstall Muse4AI' 'Gỡ Muse4AI'), 'OK', $icon) }
}
function Stop-With([string]$msg) {
  if ($Gui) { Show-Message $msg 'Warning' } else { Say $msg 'Red' }
  exit 1
}

# Same function, same text in install.ps1 (checked by desktop/test/installer-scripts.test.ts).
function Get-UninstallKeyName {
  if ($InstallRoot.TrimEnd('\') -ieq $defaultRoot.TrimEnd('\')) { return 'Muse4AI' }
  $sha = [Security.Cryptography.SHA256]::Create()
  $hex = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($InstallRoot.TrimEnd('\').ToLowerInvariant())) | Select-Object -First 4 | ForEach-Object { $_.ToString('x2') })
  return "Muse4AI-$hex"
}

function Get-RunningApps {
  # Win32_Process sees the app in every Windows session; an unreadable path counts as running.
  return @(Get-CimInstance -ClassName Win32_Process -Filter "Name='Muse4AI.exe'" -ErrorAction SilentlyContinue |
    Where-Object { -not $_.ExecutablePath -or $_.ExecutablePath.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase) })
}

function Test-Inside([string]$p) {
  return [bool]$p -and $p.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)
}

$current = if (Test-Path (Join-Path $InstallRoot 'current.txt')) { (Get-Content (Join-Path $InstallRoot 'current.txt') -Raw).Trim() } else { '' }
$exe = if ($current) { Join-Path $InstallRoot "app-$current\Muse4AI.exe" } else { '' }

# AC-RBK-02: the kept previous version is offered only when it can open the store as it is now (versions.json is
# written by the app after it opens the store; no record → no offer).
function Get-RollbackTarget {
  if (-not (Test-Path $InstallRoot)) { return $null }
  $prev = Get-ChildItem -Path $InstallRoot -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '\.bak-' -and $_.Name -ne "app-$current" -and (Test-Path (Join-Path $_.FullName 'Muse4AI.exe')) } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $prev) { return $null }
  try {
    $rec = Get-Content (Join-Path $roamingDir 'versions.json') -Raw -ErrorAction Stop | ConvertFrom-Json
    $ver = $prev.Name.Substring(4)
    $schema = $rec.versions.PSObject.Properties[$ver]
    if ($schema -and [int]$schema.Value -ge [int]$rec.storeSchema) { return $ver }
  } catch {}
  return $null
}

# True when version $a is newer than $b (same rules as compareVersions in src/shared/updates.ts).
function Test-NewerVersion([string]$a, [string]$b) {
  $re = '^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$'
  $ma = [regex]::Match($a, $re); $mb = [regex]::Match($b, $re)
  if (-not $ma.Success -or -not $mb.Success) { return $false }
  for ($i = 1; $i -le 3; $i++) {
    $x = [long]$ma.Groups[$i].Value; $y = [long]$mb.Groups[$i].Value
    if ($x -ne $y) { return $x -gt $y }
  }
  $pa = $ma.Groups[4].Value; $pb = $mb.Groups[4].Value
  if ($pa -eq $pb) { return $false }
  if (-not $pa) { return $true }
  if (-not $pb) { return $false }
  $xa = $pa.Split('.'); $xb = $pb.Split('.')
  for ($i = 0; $i -lt [Math]::Min($xa.Count, $xb.Count); $i++) {
    $na = $xa[$i] -match '^\d+$'; $nb = $xb[$i] -match '^\d+$'
    if ($na -and $nb) { if ([long]$xa[$i] -ne [long]$xb[$i]) { return [long]$xa[$i] -gt [long]$xb[$i] } ; continue }
    if ($na -ne $nb) { return $nb }
    $c = [string]::CompareOrdinal($xa[$i], $xb[$i])
    if ($c -ne 0) { return $c -gt 0 }
  }
  return $xa.Count -gt $xb.Count
}

# ---------------------------------------------------------------------------------------------- the window (-Gui)
$rollbackTo = $null
if ($Gui) {
  $rollbackTo = Get-RollbackTarget
  $form = New-Object System.Windows.Forms.Form
  $form.Text = T 'Uninstall Muse4AI' 'Gỡ Muse4AI'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.StartPosition = 'CenterScreen'
  $form.ShowInTaskbar = $true
  $form.TopMost = $true
  $form.AutoScaleMode = 'Dpi'
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 9.75)
  $form.BackColor = [System.Drawing.Color]::FromArgb(247, 244, 238)
  $form.ClientSize = New-Object System.Drawing.Size(468, 10)
  if ($exe -and (Test-Path $exe)) { try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe) } catch {} }

  $y = 20
  $title = New-Object System.Windows.Forms.Label
  $title.Text = T 'Remove Muse4AI from this computer?' 'Gỡ Muse4AI khỏi máy này?'
  $title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12)
  $title.AutoSize = $true
  $title.Location = New-Object System.Drawing.Point(20, $y)
  $form.Controls.Add($title)
  $y += 36

  $body = New-Object System.Windows.Forms.Label
  $body.Text = T 'The program and its shortcuts are removed. Images and videos in your library are always kept.' 'Chương trình và lối tắt sẽ được gỡ. Ảnh và video trong thư viện của bạn luôn được giữ nguyên.'
  $body.MaximumSize = New-Object System.Drawing.Size(428, 0)
  $body.AutoSize = $true
  $body.Location = New-Object System.Drawing.Point(20, $y)
  $form.Controls.Add($body)
  $y += $body.PreferredHeight + 16

  $check = New-Object System.Windows.Forms.CheckBox
  $check.Text = T 'Also delete accounts, proxies, settings and sign-ins saved on this computer' 'Xoá luôn tài khoản, proxy, cài đặt và phiên đăng nhập lưu trên máy này'
  # A CheckBox never wraps with AutoSize: measure the wrapped text and give it that height (text beside the box).
  $wrap = [System.Windows.Forms.TextRenderer]::MeasureText($check.Text, $form.Font, (New-Object System.Drawing.Size(404, 0)), [System.Windows.Forms.TextFormatFlags]::WordBreak)
  $check.AutoSize = $false
  $check.Size = New-Object System.Drawing.Size(428, ([Math]::Max(24, $wrap.Height + 6)))
  $check.CheckAlign = 'TopLeft'
  $check.TextAlign = 'TopLeft'
  $check.Location = New-Object System.Drawing.Point(20, $y)
  $check.Visible = $canRemoveData
  $form.Controls.Add($check)
  if ($canRemoveData) { $y += $check.Height + 12 }

  if ($rollbackTo) {
    $link = New-Object System.Windows.Forms.LinkLabel
    # After going back, the version kept on disk is the newer one: "switch to" it, never "go back to" it.
    $linkText = if (Test-NewerVersion $rollbackTo $current) { T 'Or switch to version {0} instead (keeps everything)' 'Hoặc thay vào đó, chuyển sang bản {0} (giữ nguyên mọi thứ)' } else { T 'Or go back to version {0} instead (keeps everything)' 'Hoặc thay vào đó, quay lại bản {0} (giữ nguyên mọi thứ)' }
    $link.Text = $linkText -f $rollbackTo
    $link.AutoSize = $true
    $link.Location = New-Object System.Drawing.Point(20, $y)
    $link.LinkColor = [System.Drawing.Color]::FromArgb(26, 80, 215)
    $link.add_LinkClicked({ $form.Tag = 'rollback'; $form.DialogResult = 'Retry'; $form.Close() })
    $form.Controls.Add($link)
    $y += 30
  }

  $y += 8
  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = T 'Cancel' 'Huỷ'
  $cancel.Size = New-Object System.Drawing.Size(104, 32)
  $cancel.Location = New-Object System.Drawing.Point(344, $y)
  $cancel.DialogResult = 'Cancel'
  $form.Controls.Add($cancel)
  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = T 'Uninstall' 'Gỡ cài đặt'
  $ok.Size = New-Object System.Drawing.Size(120, 32)
  $ok.Location = New-Object System.Drawing.Point(214, $y)
  $ok.DialogResult = 'OK'
  $form.Controls.Add($ok)
  $form.AcceptButton = $ok
  $form.CancelButton = $cancel
  $form.ClientSize = New-Object System.Drawing.Size(468, ($y + 52))

  $answer = $form.ShowDialog()
  if ($form.Tag -eq 'rollback' -and $rollbackTo) {
    $installer = Join-Path $PSScriptRoot 'install.ps1'
    if (-not (Test-Path $installer)) { Stop-With (T 'The rollback tool is missing; reinstall Muse4AI from the website.' 'Thiếu công cụ quay lại bản trước; hãy cài lại Muse4AI từ website.') }
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$installer`"", '-Rollback', '-Target', $rollbackTo, '-CloseRunning', '-Gui', '-InstallRoot', "`"$InstallRoot`"", '-Lang', $Lang)
    $p = Start-Process -FilePath $ps -ArgumentList $argList -PassThru -WindowStyle Hidden
    $p.WaitForExit()
    exit $p.ExitCode
  }
  if ($answer -ne 'OK') { exit 0 }
  $RemoveData = $canRemoveData -and $check.Checked
}

if ($RemoveData -and -not $canRemoveData) { Stop-With (T 'Data can only be removed for the standard install folder.' 'Chỉ xoá dữ liệu được khi gỡ bản cài ở thư mục chuẩn.') }

# ---------------------------------------------------------------------------------------------- close a running app
$busy = $null
if ($Gui) {
  $busy = New-Object System.Windows.Forms.Form
  $busy.Text = T 'Uninstall Muse4AI' 'Gỡ Muse4AI'
  $busy.FormBorderStyle = 'FixedDialog'
  $busy.ControlBox = $false
  $busy.StartPosition = 'CenterScreen'
  $busy.TopMost = $true
  $busy.Font = New-Object System.Drawing.Font('Segoe UI', 9.75)
  $busy.BackColor = [System.Drawing.Color]::FromArgb(247, 244, 238)
  $busy.ClientSize = New-Object System.Drawing.Size(380, 84)
  $busyLabel = New-Object System.Windows.Forms.Label
  $busyLabel.AutoSize = $false
  $busyLabel.Size = New-Object System.Drawing.Size(340, 44)
  $busyLabel.Location = New-Object System.Drawing.Point(20, 20)
  $busy.Controls.Add($busyLabel)
}
function Set-Busy([string]$text) {
  if ($busy) {
    $busyLabel.Text = $text
    if (-not $busy.Visible) { $busy.Show() }
    [System.Windows.Forms.Application]::DoEvents()
  } else { Say $text }
}

if ((Get-RunningApps).Count) {
  if (-not $Gui) { Say (T 'Quit Muse4AI first (right-click the tray icon → Quit).' 'Hãy thoát Muse4AI trước (chuột phải biểu tượng dưới khay → Thoát).') 'Red'; exit 1 }
  # AC-UNI-04: ask it to quit the normal way (same as tray → Quit; it asks the user when jobs are running).
  Set-Busy (T 'Closing Muse4AI…' 'Đang đóng Muse4AI…')
  if ($exe -and (Test-Path $exe)) { try { Start-Process -FilePath $exe -ArgumentList '--quit' -WindowStyle Hidden } catch {} }
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-RunningApps).Count -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
    if ($busy) { [System.Windows.Forms.Application]::DoEvents() }
  }
  Start-Sleep -Seconds 1
  if ((Get-RunningApps).Count) {
    if ($busy) { $busy.Close() }
    Stop-With (T 'Muse4AI is still open (it may be asking about running jobs). Answer it or quit it from the tray, then uninstall again. Nothing was changed.' 'Muse4AI vẫn đang mở (có thể đang hỏi về các lượt đang chạy). Hãy trả lời hoặc thoát app từ khay, rồi gỡ lại. Chưa có gì bị thay đổi.')
  }
}
Set-Busy (T 'Removing Muse4AI…' 'Đang gỡ Muse4AI…')

# A crash can leave the app's own HTTPS (Caddy) or tunnel (cloudflared) helper running. Stop only copies in the app's
# own bin folder, and only when no Muse4AI runs anywhere (another install may be using them).
$helperBin = Join-Path $localDir 'bin'
$anyApp = @(Get-CimInstance -ClassName Win32_Process -Filter "Name='Muse4AI.exe'" -ErrorAction SilentlyContinue).Count
if (-not $anyApp) {
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { ($_.Name -like 'caddy*' -or $_.Name -like 'cloudflared*') -and $_.Path -and $_.Path.StartsWith($helperBin + '\', [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Say ((T 'Stopped a leftover helper of the app: {0}' 'Đã dừng chương trình phụ còn sót của app: {0}') -f $_.Name) 'Gray' } catch {} }
}

# Shortcuts whose target is inside this install folder (never a shortcut of another copy).
$links = if ($LabData) { @((Join-Path $LabData 'shortcuts\Start Menu\Muse4AI.lnk'), (Join-Path $LabData 'shortcuts\Desktop\Muse4AI.lnk')) } else { @((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Muse4AI.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Muse4AI.lnk')) }
$wsh = New-Object -ComObject WScript.Shell
foreach ($lnk in $links) {
  if (-not (Test-Path $lnk)) { continue }
  $target = ''
  try { $target = $wsh.CreateShortcut($lnk).TargetPath } catch {}
  if (Test-Inside $target) { Remove-Item -Force $lnk }
}
# The "start with Windows" entry, only when it starts this copy.
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
foreach ($name in @('electron.app.MuseStudio', 'electron.app.Muse4AI', 'MuseStudio', 'Muse4AI')) {
  try {
    $v = (Get-ItemProperty -Path $runKey -Name $name -ErrorAction Stop).$name
    if (Test-Inside ($v.Trim().Trim('"').Split('"')[0])) { Remove-ItemProperty -Path $runKey -Name $name -ErrorAction SilentlyContinue }
  } catch {}
}

# Windows notification activator registered for this copy (same CLSID as main/toast.ts), only when it starts this copy.
$clsidKey = 'HKCU:\Software\Classes\CLSID\{8C1F2D64-3B7A-4E59-9A0D-6E2B5C71F4A3}'
try {
  $srv = (Get-ItemProperty -Path "$clsidKey\LocalServer32" -ErrorAction Stop).'(default)'
  if (Test-Inside ($srv.Trim().Trim('"').Split('"')[0])) { Remove-Item -Path $clsidKey -Recurse -Force }
} catch {}

$failed = $null
if (Test-Path $InstallRoot) {
  try { Remove-Item -Recurse -Force $InstallRoot } catch { $failed = $_.Exception.Message }
}
if ($failed) {
  if ($busy) { $busy.Close() }
  Stop-With ((T 'Some files could not be removed: {0}. Close Muse4AI and try again.' 'Không xoá được một số tệp: {0}. Hãy đóng Muse4AI rồi thử lại.') -f $failed)
}
# Its Windows Settings › Apps entry, only when that entry belongs to this install folder.
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$(Get-UninstallKeyName)"
try {
  $loc = (Get-ItemProperty -Path $key -Name 'InstallLocation' -ErrorAction Stop).InstallLocation
  if ($loc.TrimEnd('\') -ieq $InstallRoot) { Remove-Item -Path $key -Recurse -Force }
} catch {}
Say (T 'Muse4AI has been uninstalled.' 'Đã gỡ Muse4AI.') 'Green'

$dataNote = ''
if ($RemoveData) {
  # The library folder is never inside these two folders (default: Pictures\Muse4AI), so it stays untouched.
  foreach ($d in @($roamingDir, $localDir)) {
    if (Test-Path $d) { try { Remove-Item -Recurse -Force $d } catch { Say ((T 'Could not remove {0} (skipped).' 'Không xoá được {0} (bỏ qua).') -f $d) 'Yellow' } }
  }
  $dataNote = T 'App data was removed. The image/video library folder is kept.' 'Đã xoá dữ liệu app. Thư mục thư viện ảnh/video vẫn giữ nguyên.'
  Say $dataNote 'Green'
} else {
  $dataNote = T 'Your accounts and settings are kept for a later reinstall, and the library is untouched.' 'Tài khoản và cài đặt vẫn được giữ để dùng lại khi cài lại; thư viện không bị đụng tới.'
  Say $dataNote 'Gray'
}
if ($busy) { $busy.Close() }
Show-Message ("{0}`n`n{1}" -f (T 'Muse4AI has been uninstalled.' 'Đã gỡ Muse4AI.'), $dataNote)
exit 0
