import { createWebAPIs } from "./api"

import type { RuntimeAPIs } from "@openchamber/ui/api/types"
import "@openchamber/ui/index.css"
import "@openchamber/ui/styles/fonts"

declare global {
  interface Window {
    __AX_CODE_DESKTOP_RUNTIME_APIS__?: RuntimeAPIs
  }
}

window.__AX_CODE_DESKTOP_RUNTIME_APIS__ = createWebAPIs()

void import("@openchamber/ui/main")
