/**
 * `ax-code release` command tree.
 *
 * Phase 1 provides only the `check` subcommand (release readiness validation).
 * Additional subcommands (notes, bump, publish) are intentionally out of scope
 * for this phase — see PRD-2026-04-13-release-readiness-check.md.
 */

import { cmd } from "../cmd"
import { ReleaseCheckCommand } from "./check"

export const ReleaseCommand = cmd({
  command: "release",
  describe: "release utilities (check, etc.)",
  builder: (yargs) => yargs.command(ReleaseCheckCommand).demandCommand(),
  async handler() {},
})
