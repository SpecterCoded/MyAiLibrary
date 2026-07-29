import type { MenuItemConstructorOptions } from 'electron'

interface TrayMenuActions {
  open: () => void
  quit: () => void
}

export function buildTrayMenuTemplate(
  actions: TrayMenuActions,
): MenuItemConstructorOptions[] {
  return [
    { label: 'Open My AI Library', click: actions.open },
    { label: 'Quit My AI Library', click: actions.quit },
  ]
}
