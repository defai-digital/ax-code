import path from "node:path"
import { createAttachBackendPlan, createStartBackendPlan } from "../lifecycle/sidecar-plan"
import type { DesktopBackendManager } from "../lifecycle/backend-manager"
import { readDesktopReleaseDiagnostics, type DesktopReleaseDiagnostics } from "../packaging/release-diagnostics"
import { getDesktopRendererAppConfig } from "../renderer/app-config"
import { desktopSecurityBaseline } from "../security/baseline"
import { desktopCapabilityProfiles } from "../security/capability-profiles"
import { checkDesktopUpdate, downloadDesktopUpdate, openDownloadedDesktopUpdate } from "../update/check"
import { missingDesktopHostCapabilities, type DesktopHostCapabilities } from "./host-capabilities"
import { assertTrustedRendererBridgeCall, type DesktopBridgeInvoke } from "./renderer-bridge"
import type { BridgeCommandName, BridgeCommandPayload, BridgeSender, BridgeSenderValidationOptions } from "./schema"

export type DesktopBridgeHandlerOptions = {
  backend: DesktopBackendManager
  sender: BridgeSender
  senderValidation?: BridgeSenderValidationOptions
  host?: DesktopHostCapabilities
}

export function createDesktopBridgeHandler(options: DesktopBridgeHandlerOptions): DesktopBridgeInvoke {
  return async <TName extends BridgeCommandName>(name: TName, payload: unknown) => {
    const command = assertTrustedRendererBridgeCall(options.sender, name, payload, options.senderValidation)
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
    case "platform.capabilities": {
      const release = readDesktopReleaseDiagnostics()
      return {
        app: {
          name: "@ax-code/desktop",
          version: desktopRuntimeVersion(release),
        },
        renderer: {
          name: "@ax-code/app",
          version: desktopRuntimeVersion(release),
        },
        platform: process.platform,
        arch: process.arch,
        desktopBridge: true,
        security: {
          contentOrigin: desktopSecurityBaseline.contentOrigin,
          contextIsolation: desktopSecurityBaseline.contextIsolation,
          nodeIntegration: desktopSecurityBaseline.nodeIntegration,
          sandbox: desktopSecurityBaseline.sandbox,
        },
        capabilityProfiles: desktopCapabilityProfiles,
        release,
      }
    }

    case "release.checkUpdate":
      return checkDesktopUpdate(readDesktopReleaseDiagnostics())

    case "release.downloadUpdate":
      return downloadDesktopUpdate(readDesktopReleaseDiagnostics())

    case "release.openDownloadedUpdate":
      return openDownloadedDesktopUpdate(
        readDesktopReleaseDiagnostics(),
        payload as BridgeCommandPayload<"release.openDownloadedUpdate">,
        {
          openArtifact: (artifactPath) => host.openUpdateArtifact(artifactPath),
        },
      )

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
      return backend.reconnect(createStartBackendPlan(payload as BridgeCommandPayload<"backend.start">))

    case "backend.attach":
      return backend.reconnect(createAttachBackendPlan(payload as BridgeCommandPayload<"backend.attach">))

    case "external.open":
      await host.openExternal((payload as BridgeCommandPayload<"external.open">).url)
      return true

    case "dialog.chooseDirectory":
      return host.chooseDirectory(payload as BridgeCommandPayload<"dialog.chooseDirectory">)

    case "path.reveal":
      await host.revealPath(resolveWorkspacePath(backend, (payload as BridgeCommandPayload<"path.reveal">).path))
      return true

    case "editor.open": {
      const editorPayload = payload as BridgeCommandPayload<"editor.open">
      const editorInput: { path: string; line?: number; column?: number } = {
        path: resolveWorkspacePath(backend, editorPayload.path),
      }
      if (editorPayload.line !== undefined) editorInput.line = editorPayload.line
      if (editorPayload.column !== undefined) editorInput.column = editorPayload.column
      await host.openEditor(editorInput)
      return true
    }

    case "notification.show":
      return host.showNotification(payload as BridgeCommandPayload<"notification.show">)
  }
}

function desktopRuntimeVersion(release: DesktopReleaseDiagnostics) {
  return release.version ?? process.env.npm_package_version ?? "0.0.0"
}

function resolveWorkspacePath(backend: DesktopBackendManager, targetPath: string) {
  const directory = backend.getConnection()?.directory
  if (!directory) throw new Error("Desktop file actions require a connected workspace directory.")
  const workspaceRoot = path.resolve(directory)
  const resolved = path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(workspaceRoot, targetPath)
  if (!isPathInsideDirectory(resolved, workspaceRoot)) {
    throw new Error("Desktop file actions must stay inside the connected workspace.")
  }
  return resolved
}

function isPathInsideDirectory(targetPath: string, directory: string) {
  const relative = path.relative(directory, targetPath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
