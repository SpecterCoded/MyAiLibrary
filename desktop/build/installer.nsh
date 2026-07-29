; Segoe UI ships with supported Windows versions and keeps the installer
; crisp and consistent without bundling a fragile third-party font.
!define MUI_FONT "Segoe UI"
!define MUI_FONTSIZE 9

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to MyAiLibrary"
  !define MUI_WELCOMEPAGE_TEXT "Install your private AI-powered library and knowledge workspace.$\r$\n$\r$\nYour database, indexes, and downloaded models remain in your local application data folder across upgrades."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Uninstall MyAiLibrary"
  !define MUI_WELCOMEPAGE_TEXT "This removes the application. Your personal library data is kept so it can be restored after reinstalling."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro refreshMyAiLibraryShellIcons
  ; Ask Explorer/Start Menu/taskbar to refresh cached icons after install changes.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customInstall
  !insertmacro refreshMyAiLibraryShellIcons
!macroend

!macro customUnInstall
  !insertmacro refreshMyAiLibraryShellIcons
!macroend
