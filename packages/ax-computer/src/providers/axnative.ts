import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { OcuProtocolProvider } from "./ocu-protocol"

/**
 * Default command for the AX-owned native driver: the SwiftPM build product
 * under native/ax-computer-driver/.build (release preferred over debug),
 * falling back to `ax-computer-driver` on PATH when nothing is built. The
 * `exists` probe is injectable for tests.
 */
export function defaultAxnativeCommand(exists: (candidate: string) => boolean = fs.existsSync): string {
  const buildDir = fileURLToPath(new URL("../../native/ax-computer-driver/.build", import.meta.url))
  for (const configuration of ["release", "debug"]) {
    const candidate = path.join(buildDir, configuration, "ax-computer-driver")
    if (exists(candidate)) return candidate
  }
  return "ax-computer-driver"
}

/**
 * Provider for `ax-computer-driver`, the AX-owned macOS computer-use driver
 * (native/ax-computer-driver, ported from OCU). It speaks the same MCP tool
 * surface as OCU, so all behavior is inherited; only the provider name and
 * the default command resolution differ.
 *
 * Command precedence: config.command > AX_COMPUTER_AXNATIVE_COMMAND env >
 * built binary (release, then debug) > "ax-computer-driver" on PATH.
 */
export class AXNativeProvider extends OcuProtocolProvider {
  override readonly name = "axnative"

  protected override commandEnvVar(): string {
    return "AX_COMPUTER_AXNATIVE_COMMAND"
  }

  protected override defaultCommand(): string {
    return defaultAxnativeCommand()
  }
}
