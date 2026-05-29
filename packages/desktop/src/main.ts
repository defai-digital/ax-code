import { parseArgs } from "node:util"
import { DesktopBackendManager } from "./lifecycle/backend-manager"
import { createElectronHostPlan } from "./electron/config"
import { startElectronDesktopHost } from "./electron/host"
import { desktopMainArgs } from "./main-args"
import { desktopSecurityBaseline } from "./security/baseline"

const { values } = parseArgs({
  args: desktopMainArgs(process.argv),
  options: {
    "dry-run": { type: "boolean", default: false },
    dev: { type: "boolean", default: false },
    "renderer-url": { type: "string" },
    directory: { type: "string" },
    "attach-url": { type: "string" },
    "auth-header": { type: "string" },
    "package-target": { type: "string" },
  },
  strict: false,
  allowPositionals: true,
})

const dryRun = values["dry-run"] === true
const dev = values.dev === true
const rendererUrl = stringValue(values["renderer-url"])
const directory = stringValue(values.directory)
const attachUrl = stringValue(values["attach-url"])
const authHeader = stringValue(values["auth-header"])
const packageTarget = stringValue(values["package-target"])

if (dryRun) {
  const backend = new DesktopBackendManager()
  const electron = createElectronHostPlan({
    dev,
    rendererUrl,
  })
  console.log(
    JSON.stringify(
      {
        name: "@ax-code/desktop",
        mode: "electron-host-plan",
        packageTarget,
        backend: backend.diagnostics(),
        electron,
        security: {
          contentOrigin: desktopSecurityBaseline.contentOrigin,
          contextIsolation: desktopSecurityBaseline.contextIsolation,
          nodeIntegration: desktopSecurityBaseline.nodeIntegration,
          sandbox: desktopSecurityBaseline.sandbox,
        },
      },
      null,
      2,
    ),
  )
  process.exit(0)
} else {
  void startElectronDesktopHost({ dev, rendererUrl, directory, attachUrl, authHeader }).catch((cause) => {
    const message = cause instanceof Error ? cause.stack || cause.message : String(cause)
    console.error(`AX Code desktop host failed to start: ${message}`)
    process.exitCode = 1
  })
}

function stringValue(value: string | boolean | undefined) {
  return typeof value === "string" ? value : undefined
}
