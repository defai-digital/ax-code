import { OcuProtocolProvider } from "../../src/providers/ocu-protocol"

/**
 * Test-only reference arm for the upstream OCU backend (`open-computer-use
 * mcp`). The upstream provider is not a production backend — it exists so live
 * A/B and compat suites can compare the AX-owned driver against the upstream
 * reference. The `name = "ocu"` label is deliberate: A/B report columns and
 * last-report.json evidence stay comparable with historical runs.
 */
export class UpstreamOcuReferenceProvider extends OcuProtocolProvider {
  readonly name = "ocu"

  protected commandEnvVar(): string {
    return "AX_COMPUTER_OCU_COMMAND"
  }

  protected defaultCommand(): string {
    return "open-computer-use"
  }
}
