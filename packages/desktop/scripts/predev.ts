import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../ax-code/dist/${sidecarConfig.ocBinary}/bin/ax-code`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../ax-code && bun run build --single --baseline`
  : $`cd ../ax-code && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
