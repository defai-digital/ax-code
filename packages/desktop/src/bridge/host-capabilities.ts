export type DesktopHostCapabilities = {
  openExternal(url: string): Promise<void>
  chooseDirectory(input: { title?: string }): Promise<{ path?: string; canceled: boolean }>
  revealPath(path: string): Promise<void>
  showNotification(input: { title: string; body?: string; silent?: boolean }): Promise<boolean>
}

export function missingDesktopHostCapabilities(): DesktopHostCapabilities {
  return {
    async openExternal() {
      throw new Error("external.open is not available without a desktop host")
    },
    async chooseDirectory() {
      throw new Error("dialog.chooseDirectory is not available without a desktop host")
    },
    async revealPath() {
      throw new Error("path.reveal is not available without a desktop host")
    },
    async showNotification() {
      throw new Error("notification.show is not available without a desktop host")
    },
  }
}
