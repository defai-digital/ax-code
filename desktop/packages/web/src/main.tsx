import { createWebAPIs } from "./api"
import { installAppProtocolNetworkRewrites } from "./app-protocol-network"

import type { RuntimeAPIs } from "@openchamber/ui/api/types"
import "@openchamber/ui/index.css"
import "@openchamber/ui/styles/fonts"

declare global {
  interface Window {
    __AX_CODE_DESKTOP_RUNTIME_APIS__?: RuntimeAPIs
    __AX_CODE_DESKTOP_DESKTOP_SERVER__?: { origin?: string }
  }
}

installAppProtocolNetworkRewrites({
  pageOrigin: window.location.origin,
  apiOrigin: window.__AX_CODE_DESKTOP_DESKTOP_SERVER__?.origin,
})

window.__AX_CODE_DESKTOP_RUNTIME_APIS__ = createWebAPIs()

void import("@openchamber/ui/main")
