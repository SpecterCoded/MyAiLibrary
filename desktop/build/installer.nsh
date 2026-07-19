!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to My AI Library"
  !define MUI_WELCOMEPAGE_TEXT "Install your private AI-powered library and knowledge workspace.$\r$\n$\r$\nYour database, indexes, and downloaded models remain in your local application data folder across upgrades."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Uninstall My AI Library"
  !define MUI_WELCOMEPAGE_TEXT "This removes the application. Your personal library data is kept so it can be restored after reinstalling."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
