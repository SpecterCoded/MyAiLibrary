import type { MenuItemConstructorOptions } from 'electron'

interface TrayMenuActions {
  open: () => void
  quit: () => void
}

export function buildTrayMenuTemplate(
  actions: TrayMenuActions,
): MenuItemConstructorOptions[] {
  return [
    { label: 'Open MyAiLibrary', click: actions.open },
    { label: 'Quit MyAiLibrary', click: actions.quit },
  ]
}
