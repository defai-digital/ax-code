import { parseArgs } from "node:util"
import { DesktopBackendManager } from "./lifecycle/backend-manager"
import { createElectronHostPlan } from "./electron/config"
import { startElectronDesktopHost } from "./electron/host"
import { desktopSecurityBaseline } from "./security/baseline"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    dev: { type: "boolean", default: false },
    "renderer-url": { type: "string" },
    directory: { type: "string" },
    "attach-url": { type: "string" },
    "auth-header": { type: "string" },
    "package-target": { type: "string" },
  },
  strict: true,
  allowPositionals: false,
})

if (values["dry-run"]) {
  const backend = new DesktopBackendManager()
  const electron = createElectronHostPlan({
    dev: Boolean(values.dev),
    rendererUrl: values["renderer-url"],
  })
  console.log(
    JSON.stringify(
      {
        name: "@ax-code/desktop",
        mode: "electron-host-plan",
        packageTarget: values["package-target"],
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
} else {
  await startElectronDesktopHost({
    dev: values.dev,
    rendererUrl: values["renderer-url"],
    directory: values.directory,
    attachUrl: values["attach-url"],
    authHeader: values["auth-header"],
  })
}
