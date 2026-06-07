Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var RemoveAppData
Var RemoveAppDataCheckbox

Name "Narrato"
OutFile "Narrato_Setup.exe"
InstallDir "$PROGRAMFILES64\Narrato"
InstallDirRegKey HKCU "Software\Narrato" "InstallDir"

; Request administrative privileges to install into Program Files
RequestExecutionLevel admin

; Modern UI Appearance
!define MUI_ABORTWARNING
!define MUI_ICON "..\frontend\public\logo.ico"
!define MUI_UNICON "..\frontend\public\logo.ico"

; Welcome, Directory selection, Progress and Finish Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
UninstPage custom un.AppDataPage un.AppDataPageLeave
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; Initialize plugins/temp directory to copy download helper script first
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "download_assets.ps1"

  DetailPrint "Checking network and downloading required components (FFmpeg, Node.js)..."
  nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -File "$PLUGINSDIR\download_assets.ps1"'
  Pop $0
  
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Failed to download required components (FFmpeg, Node.js). Installation will now abort."
    Abort
  ${EndIf}

  ; Succeeded or skipped because they exist. Now extract application files to installation folder.
  SetOutPath "$INSTDIR"
  File /r "..\dist\Narrato\*"
  File "..\frontend\public\logo.ico"

  ; Write uninstall information into Windows registry
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Narrato" "DisplayName" "Narrato"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Narrato" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Narrato" "DisplayIcon" '"$INSTDIR\logo.ico"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Narrato" "Publisher" "Himanshu Kumar Shahi"
  WriteRegStr HKCU "Software\Narrato" "InstallDir" "$INSTDIR"

  ; Create uninstaller executable
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Create shortcuts in Start Menu and Desktop
  CreateDirectory "$SMPROGRAMS\Narrato"
  CreateShortcut "$SMPROGRAMS\Narrato\Narrato.lnk" "$INSTDIR\Narrato.exe" "" "$INSTDIR\logo.ico" 0
  CreateShortcut "$SMPROGRAMS\Narrato\Uninstall Narrato.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\logo.ico" 0
  CreateShortcut "$DESKTOP\Narrato.lnk" "$INSTDIR\Narrato.exe" "" "$INSTDIR\logo.ico" 0
SectionEnd

Function un.AppDataPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  
  !insertmacro MUI_HEADER_TEXT "Uninstall Narrato" "Choose whether to remove application data."
  
  ${NSD_CreateLabel} 0 0 100% 30u "The uninstaller can remove the application's configuration, logs, and database files in addition to the program files.$\r$\n$\r$\nDo you want to completely remove all application data, or leave it for future installations?"
  Pop $0
  
  ${NSD_CreateCheckbox} 0 50u 100% 10u "Remove application data completely (database, settings, and logs)"
  Pop $RemoveAppDataCheckbox
  
  ; Default to leaving appdata intact (uncheck)
  ${NSD_Uncheck} $RemoveAppDataCheckbox
  
  nsDialogs::Show
FunctionEnd

Function un.AppDataPageLeave
  ${NSD_GetState} $RemoveAppDataCheckbox $0
  StrCpy $RemoveAppData $0
FunctionEnd

Section "Uninstall"
  ; Delete all installed files
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR"

  ; Delete shortcuts
  Delete "$SMPROGRAMS\Narrato\Narrato.lnk"
  Delete "$SMPROGRAMS\Narrato\Uninstall Narrato.lnk"
  RMDir "$SMPROGRAMS\Narrato"
  Delete "$DESKTOP\Narrato.lnk"

  ; Delete registry keys
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Narrato"
  DeleteRegKey HKCU "Software\Narrato"

  ; Delete AppData if requested
  ${If} $RemoveAppData == ${BST_CHECKED}
    RMDir /r "$LOCALAPPDATA\Narrato"
  ${EndIf}
SectionEnd
