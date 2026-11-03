MUSE STUDIO — INSTALL GUIDE (test build, not code-signed)   ·   Tiếng Việt: README-cai-dat.txt

1. Extract this ZIP into any folder (for example Downloads\Muse4AI).
2. Open the extracted folder, click the address bar, type  powershell  and press Enter.
3. Run:
     powershell -ExecutionPolicy Bypass -File .\install.ps1
   The installer checks the package's SHA-256, installs into %LOCALAPPDATA%\Programs\Muse4AI,
   creates Start Menu and Desktop shortcuts and opens the app. No admin rights needed.
   Or use Muse4AI-<version>-Setup-win-x64.exe: double-click, pick English or Tiếng Việt, Next.

Install a new version: quit Muse4AI (right-click the tray icon → Quit), then run the command above
with the new package. Data, accounts and the library are kept.

Roll back:            powershell -ExecutionPolicy Bypass -File .\install.ps1 -Rollback
Uninstall (keep data): powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
Uninstall and remove app data (the image/video folder is kept): add  -RemoveData
Installer messages: add  -Lang en  or  -Lang vi  (default: the app's language, else English).

Windows may warn you because the app is not signed — this is a test build.
Full guide: INSTALL-GUIDE.md
