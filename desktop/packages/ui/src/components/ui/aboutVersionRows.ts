export type AboutVersionRow = {
  key: "version" | "desktop" | "cli"
  label: "aboutDialog.versionLabel" | "aboutDialog.openChamberVersionLabel" | "aboutDialog.axCodeVersionLabel"
  version: string
}

export function aboutVersionRows(desktopVersion: string | null, cliVersion: string | null): AboutVersionRow[] {
  const desktop = desktopVersion?.trim() || null
  const cli = cliVersion?.trim() || null
  if (desktop && cli && desktop === cli) {
    return [{ key: "version", label: "aboutDialog.versionLabel", version: desktop }]
  }
  return [
    ...(desktop ? ([{ key: "desktop", label: "aboutDialog.openChamberVersionLabel", version: desktop }] as const) : []),
    ...(cli ? ([{ key: "cli", label: "aboutDialog.axCodeVersionLabel", version: cli }] as const) : []),
  ]
}
