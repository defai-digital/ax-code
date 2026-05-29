import path from "node:path"
import { createAttachBackendPlan, createStartBackendPlan } from "../lifecycle/sidecar-plan"
import type { DesktopBackendManager } from "../lifecycle/backend-manager"
import { readDesktopReleaseDiagnostics } from "../packaging/release-diagnostics"
import { getDesktopRendererAppConfig } from "../renderer/app-config"
import { desktopSecurityBaseline } from "../security/baseline"
import { missingDesktopHostCapabilities, type DesktopHostCapabilities } from "./host-capabilities"
import { assertTrustedRendererBridgeCall, type DesktopBridgeInvoke } from "./renderer-bridge"
import type { BridgeCommandName, BridgeCommandPayload, BridgeSender } from "./schema"

export type DesktopBridgeHandlerOptions = {
  backend: DesktopBackendManager
  sender: BridgeSender
  host?: DesktopHostCapabilities
}

export function createDesktopBridgeHandler(options: DesktopBridgeHandlerOptions): DesktopBridgeInvoke {
  return async <TName extends BridgeCommandName>(name: TName, payload: unknown) => {
    const command = assertTrustedRendererBridgeCall(options.sender, name, payload)
    return handleDesktopBridgeCommand(options.backend, command.name, command.payload, {
      host: options.host,
    })
  }
}

export async function handleDesktopBridgeCommand<TName extends BridgeCommandName>(
  backend: DesktopBackendManager,
  name: TName,
  payload: BridgeCommandPayload<TName>,
  options: {
    host?: DesktopHostCapabilities
  } = {},
) {
  const host = options.host ?? missingDesktopHostCapabilities()

  switch (name) {
    case "platform.capabilities":
      return {
        platform: process.platform,
        arch: process.arch,
        desktopBridge: true,
        security: {
          contentOrigin: desktopSecurityBaseline.contentOrigin,
          contextIsolation: desktopSecurityBaseline.contextIsolation,
          nodeIntegration: desktopSecurityBaseline.nodeIntegration,
          sandbox: desktopSecurityBaseline.sandbox,
        },
        release: readDesktopReleaseDiagnostics(),
      }

    case "diagnostics.read":
      return backend.diagnostics()

    case "app.config":
      return getDesktopRendererAppConfig(backend)

    case "diagnostics.exportLogs":
      return {
        text: backend.exportLogs(),
        includeBackendLogs: (payload as BridgeCommandPayload<"diagnostics.exportLogs">).includeBackendLogs,
      }

    case "backend.start":
      return backend.connect(createStartBackendPlan(payload as BridgeCommandPayload<"backend.start">))

    case "backend.attach":
      return backend.connect(createAttachBackendPlan(payload as BridgeCommandPayload<"backend.attach">))

    case "external.open":
      await host.openExternal((payload as BridgeCommandPayload<"external.open">).url)
      return true

    case "dialog.chooseDirectory":
      return host.chooseDirectory(payload as BridgeCommandPayload<"dialog.chooseDirectory">)

    case "path.reveal":
      await host.revealPath(resolveRevealPath(backend, (payload as BridgeCommandPayload<"path.reveal">).path))
      return true

    case "notification.show":
      return host.showNotification(payload as BridgeCommandPayload<"notification.show">)
  }
}

function resolveRevealPath(backend: DesktopBackendManager, targetPath: string) {
  if (path.isAbsolute(targetPath)) return targetPath
  const directory = backend.getConnection()?.directory
  return directory ? path.resolve(directory, targetPath) : targetPath
}
