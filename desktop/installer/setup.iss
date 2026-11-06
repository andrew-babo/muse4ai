; EXE front-end for the existing R22 installer, not a second installation engine.
; Bilingual (R124): English first (default), Vietnamese from Inno Setup's Vietnamese.isl; the picked language is passed
; to install.ps1 (-Lang), which also makes it the app's first language when the app has none saved yet.
#ifndef AppVersion
  #error AppVersion must be supplied by the packaging script
#endif
#ifndef StageDir
  #error StageDir must be supplied by the packaging script
#endif
#ifndef OutputPath
  #error OutputPath must be supplied by the packaging script
#endif

[Setup]
AppId=MuseStudioSetup
AppName=Muse4AI
AppVersion={#AppVersion}
AppPublisher=Andrew Babo
AppCopyright=© 2026 Andrew Babo
DefaultDirName={localappdata}\Programs\Muse4AI
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=lowest
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir={#OutputPath}
OutputBaseFilename=Muse4AI-{#AppVersion}-Setup-win-x64
SetupIconFile=..\resources\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
WizardImageFile=wizard-100.bmp,wizard-150.bmp,wizard-200.bmp
WizardSmallImageFile=wizard-small-100.bmp,wizard-small-200.bmp
WizardImageStretch=no
ArchitecturesAllowed=x64compatible
MinVersion=10.0
ShowLanguageDialog=yes
LanguageDetectionMethod=uilanguage
UsePreviousLanguage=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"; InfoBeforeFile: "setup-notice-en.txt"
Name: "vi"; MessagesFile: "Vietnamese.isl"; InfoBeforeFile: "setup-notice.txt"

[CustomMessages]
en.Working=Setting up Muse4AI… your library and settings stay safe.
vi.Working=Đang chuẩn bị Muse4AI… thư viện và cài đặt của bạn được giữ nguyên.
en.LaunchApp=Open Muse4AI
vi.LaunchApp=Mở Muse4AI
en.NoPowerShell=Could not start PowerShell to install Muse4AI.
vi.NoPowerShell=Không mở được PowerShell để cài Muse4AI.
en.InstallFailed=Installation did not complete. Quit Muse4AI and try again; if it still fails, use the ZIP package to see the details. Your data and library are kept.
vi.InstallFailed=Cài đặt không thành công. Hãy thoát Muse4AI và thử lại; nếu vẫn lỗi, dùng gói ZIP để xem chi tiết. Dữ liệu và thư viện được giữ nguyên.

en.DataKept=Your data and library are kept.
vi.DataKept=Dữ liệu và thư viện của bạn được giữ nguyên.

[Files]
Source: "{#StageDir}\*"; Flags: dontcopy

[Run]
Filename: "{code:AppExe}"; Description: "{cm:LaunchApp}"; Flags: postinstall nowait skipifsilent
; Build 3.3 AC-UPD-06: the app's "Cài và mở lại" runs setup with /SILENT /RELAUNCH=1 — reopen the new version afterwards.
Filename: "{code:AppExe}"; Flags: nowait; Check: ShouldRelaunch

[Code]
{ Build 3.3: /INSTALLROOT=<folder> installs where the running app lives (the in-app update passes it); default is the
  standard per-user folder. Never a quote inside: the value is passed on to install.ps1 inside quotes. }
function InstallRootDir(): String;
begin
  Result := ExpandConstant('{param:INSTALLROOT|}');
  if Result = '' then Result := ExpandConstant('{localappdata}\Programs\Muse4AI');
end;

function AppExe(Param: String): String;
begin
  Result := InstallRootDir() + '\app-{#AppVersion}\Muse4AI.exe';
end;

function ShouldRelaunch(): Boolean;
begin
  Result := WizardSilent() and (ExpandConstant('{param:RELAUNCH|0}') = '1');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
  Args, ResultFile, Reason, Root: String;
  Lines: TArrayOfString;
  I: Integer;
begin
  if CurStep = ssInstall then
  begin
    WizardForm.StatusLabel.Caption := CustomMessage('Working');
    ExtractTemporaryFiles('*');
    ResultFile := ExpandConstant('{tmp}\result.txt');
    Args := '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\install.ps1') + '" -NoLaunch -CloseRunning -ResultFile "' + ResultFile + '" -Lang ' + ActiveLanguage;
    Root := ExpandConstant('{param:INSTALLROOT|}');
    if Root <> '' then
    begin
      if Pos('"', Root) > 0 then RaiseException(CustomMessage('InstallFailed'));
      Args := Args + ' -InstallRoot "' + Root + '"';
    end;
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args,
      ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      RaiseException(CustomMessage('NoPowerShell'));
    if ExitCode <> 0 then
    begin
      Reason := '';
      if LoadStringsFromFile(ResultFile, Lines) then
        for I := 0 to GetArrayLength(Lines) - 1 do
          if Trim(Lines[I]) <> '' then Reason := Reason + Trim(Lines[I]) + #13#10;
      if Reason <> '' then
        RaiseException(Reason + #13#10 + CustomMessage('DataKept'))
      else
        RaiseException(CustomMessage('InstallFailed'));
    end;
  end;
end;
