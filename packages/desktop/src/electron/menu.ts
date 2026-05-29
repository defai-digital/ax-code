export const DESKTOP_MENU_COMMAND_CHANNEL = "ax-code:menu-command"

export const DESKTOP_MENU_COMMANDS = [
  "session.new",
  "composer.focus",
  "composer.run",
  "composer.queue",
  "diagnostics.refresh",
] as const

export type DesktopMenuCommand = (typeof DESKTOP_MENU_COMMANDS)[number]

type DesktopMenuItem = {
  label?: string
  submenu?: DesktopMenuItem[]
  accelerator?: string
  role?: string
  type?: string
  click?: () => void
}

type DesktopMenuWindow = {
  isDestroyed?: () => boolean
  webContents?: {
    send(channel: string, payload: unknown): void
  }
}

export function createDesktopApplicationMenuTemplate(input: {
  platform?: NodeJS.Platform
  sendCommand: (command: DesktopMenuCommand) => void
}): DesktopMenuItem[] {
  const isMac = input.platform === "darwin"
  const appMenu: DesktopMenuItem[] = isMac
    ? [
        {
          label: "AX Code",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
      ]
    : []

  return [
    ...appMenu,
    {
      label: "File",
      submenu: [
        menuCommand("New Session", "CommandOrControl+N", "session.new", input.sendCommand),
        menuCommand("Focus Composer", "CommandOrControl+L", "composer.focus", input.sendCommand),
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Run",
      submenu: [
        menuCommand("Run Draft", "CommandOrControl+Enter", "composer.run", input.sendCommand),
        menuCommand("Queue Draft", "CommandOrControl+Shift+Enter", "composer.queue", input.sendCommand),
      ],
    },
    {
      label: "View",
      submenu: [
        menuCommand("Refresh Diagnostics", "CommandOrControl+R", "diagnostics.refresh", input.sendCommand),
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, ...(isMac ? [{ type: "separator" }, { role: "front" }] : [])],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "AX Code Diagnostics",
          click: () => input.sendCommand("diagnostics.refresh"),
        },
      ],
    },
  ]
}

export function installDesktopApplicationMenu(
  electron: {
    Menu?: {
      buildFromTemplate(template: DesktopMenuItem[]): unknown
      setApplicationMenu(menu: unknown): void
    }
  },
  windowProvider: () => DesktopMenuWindow | undefined,
  platform: NodeJS.Platform = process.platform,
) {
  if (!electron.Menu?.buildFromTemplate || !electron.Menu?.setApplicationMenu) return false
  const template = createDesktopApplicationMenuTemplate({
    platform,
    sendCommand: (command) => {
      sendDesktopMenuCommand(windowProvider(), command)
    },
  })
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template))
  return true
}

export function sendDesktopMenuCommand(target: DesktopMenuWindow | undefined, command: DesktopMenuCommand) {
  if (!target || target.isDestroyed?.() === true || !target.webContents?.send) return false
  target.webContents.send(DESKTOP_MENU_COMMAND_CHANNEL, { command })
  return true
}

function menuCommand(
  label: string,
  accelerator: string,
  command: DesktopMenuCommand,
  sendCommand: (command: DesktopMenuCommand) => void,
): DesktopMenuItem {
  return {
    label,
    accelerator,
    click: () => sendCommand(command),
  }
}
