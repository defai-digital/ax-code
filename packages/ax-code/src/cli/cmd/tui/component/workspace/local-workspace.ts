export const LOCAL_WORKSPACE_ID = "__local__"

export function localWorkspaceDirectory(input: { baseDirectory?: string; fallbackDirectory?: string }) {
  return input.baseDirectory ?? input.fallbackDirectory ?? ""
}

export function currentWorkspaceSelection(input: {
  routeType: "home" | "session"
  homeWorkspaceID?: string
  sessionDirectory?: string
  localDirectory?: string
}) {
  if (input.routeType === "home") {
    return input.homeWorkspaceID ?? LOCAL_WORKSPACE_ID
  }

  if (!input.sessionDirectory || input.sessionDirectory === input.localDirectory) {
    return LOCAL_WORKSPACE_ID
  }

  return input.sessionDirectory
}
