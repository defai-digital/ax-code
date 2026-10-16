// Version of an upgrade the user started from a dialog in this process. The
// server also broadcasts installation.updated for it, which would otherwise
// show a second "updated in the background" toast.
export const interactiveUpgrade: { version: string | undefined } = { version: undefined }
