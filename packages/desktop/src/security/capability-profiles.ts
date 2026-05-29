export type DesktopSecurityReviewArea =
  | "authentication"
  | "access-control"
  | "input-validation"
  | "os-command-execution"
  | "origin-csp"
  | "local-resource-roots"
  | "audit-revocation"
  | "secret-handling"
  | "scheduler-ownership"
  | "workspace-trust"

export type DesktopCapabilityProfile = {
  id: "trusted-local-app" | "browser-preview" | "remote-host" | "tunnel" | "pwa-network" | "vscode-webview"
  label: string
  status: "enabled" | "disabled"
  origin: "app-protocol-or-loopback" | "loopback-preview" | "not-configured"
  bridge: "trusted-desktop" | "none"
  commands: string[]
  localResources: "workspace-scoped" | "none" | "separate-gate-required"
  network: "loopback-only" | "disabled" | "separate-gate-required"
  gate?: string
  threatModel?: string
  securityReviews?: DesktopSecurityReviewArea[]
}

export const remoteSurfaceRequiredSecurityReviews: DesktopSecurityReviewArea[] = [
  "authentication",
  "access-control",
  "input-validation",
  "os-command-execution",
]

export const desktopCapabilityProfiles: DesktopCapabilityProfile[] = [
  {
    id: "trusted-local-app",
    label: "Trusted local desktop app",
    status: "enabled",
    origin: "app-protocol-or-loopback",
    bridge: "trusted-desktop",
    commands: [
      "app.config",
      "backend.attach",
      "backend.start",
      "diagnostics.exportLogs",
      "diagnostics.read",
      "dialog.chooseDirectory",
      "editor.open",
      "external.open",
      "notification.show",
      "path.reveal",
      "platform.capabilities",
      "release.checkUpdate",
      "release.downloadUpdate",
      "release.openDownloadedUpdate",
    ],
    localResources: "workspace-scoped",
    network: "loopback-only",
  },
  {
    id: "browser-preview",
    label: "Browser preview",
    status: "enabled",
    origin: "loopback-preview",
    bridge: "none",
    commands: [],
    localResources: "none",
    network: "loopback-only",
    gate: "ADR-021",
  },
  {
    id: "remote-host",
    label: "Remote host",
    status: "disabled",
    origin: "not-configured",
    bridge: "none",
    commands: [],
    localResources: "separate-gate-required",
    network: "separate-gate-required",
    gate: "ADR-023 RSG-1",
    threatModel:
      "Remote host execution can blur host identity, workspace roots, command execution, secrets, scheduler ownership, and permission prompts.",
    securityReviews: [
      ...remoteSurfaceRequiredSecurityReviews,
      "origin-csp",
      "local-resource-roots",
      "audit-revocation",
      "secret-handling",
      "scheduler-ownership",
      "workspace-trust",
    ],
  },
  {
    id: "tunnel",
    label: "Tunnel",
    status: "disabled",
    origin: "not-configured",
    bridge: "none",
    commands: [],
    localResources: "separate-gate-required",
    network: "separate-gate-required",
    gate: "ADR-023 RSG-2",
    threatModel:
      "Tunnel exposure can publish local projects or previews to untrusted clients and bypass local-only permission expectations.",
    securityReviews: [
      ...remoteSurfaceRequiredSecurityReviews,
      "origin-csp",
      "local-resource-roots",
      "audit-revocation",
    ],
  },
  {
    id: "pwa-network",
    label: "PWA/network",
    status: "disabled",
    origin: "not-configured",
    bridge: "none",
    commands: [],
    localResources: "separate-gate-required",
    network: "separate-gate-required",
    gate: "ADR-023 RSG-3",
    threatModel:
      "Browser/PWA access can persist tokens, service workers, and cross-origin state outside the trusted desktop bridge boundary.",
    securityReviews: [
      ...remoteSurfaceRequiredSecurityReviews,
      "origin-csp",
      "local-resource-roots",
      "audit-revocation",
    ],
  },
  {
    id: "vscode-webview",
    label: "VS Code webview",
    status: "disabled",
    origin: "not-configured",
    bridge: "none",
    commands: [],
    localResources: "separate-gate-required",
    network: "separate-gate-required",
    gate: "ADR-023 RSG-4",
    threatModel:
      "Editor-embedded UI can confuse extension-host trust, workspace trust, command execution, filesystem access, and desktop/session identity.",
    securityReviews: [
      ...remoteSurfaceRequiredSecurityReviews,
      "origin-csp",
      "local-resource-roots",
      "audit-revocation",
      "workspace-trust",
    ],
  },
]
