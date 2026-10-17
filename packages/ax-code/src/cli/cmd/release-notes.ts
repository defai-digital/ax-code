import { Installation } from "../../installation"
import { cmd } from "./cmd"
import { loadChangelogText, renderReleaseNotesHuman, resolveReleaseNotes } from "../../util/changelog"

export { renderReleaseNotesHuman }

/**
 * `ax-code release-notes [--version X] [--json]` (ADR-242): print the CHANGELOG
 * section for the running version (or the given one). The text is embedded at
 * build time; a source checkout reads the repository CHANGELOG.md instead, and
 * a build without either reports that release notes are unavailable.
 */
export const ReleaseNotesCommand = cmd({
  command: "release-notes",
  describe: "print the CHANGELOG release notes for the running version or a given one",
  builder: (yargs) =>
    yargs
      .option("version", {
        alias: ["v"],
        type: "string",
        describe: "version to print release notes for (defaults to the running version)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Emit a single machine-readable JSON document",
      }),
  handler: async (args) => {
    const changelog = await loadChangelogText()
    const requested = args.version?.trim()
    // Default to the running version, but fall back to the latest released
    // section when this build's version is not yet in the changelog (dev/source).
    let outcome = resolveReleaseNotes({ changelog, version: requested ?? Installation.VERSION })
    if (outcome.status === "not-found" && !requested) outcome = resolveReleaseNotes({ changelog })

    if (args.json) {
      process.stdout.write(JSON.stringify(outcome, null, 2) + "\n")
    } else if (outcome.status === "ok") {
      process.stdout.write(renderReleaseNotesHuman(outcome) + "\n")
    } else {
      process.stderr.write(renderReleaseNotesHuman(outcome) + "\n")
    }
    if (outcome.status !== "ok") process.exitCode = 1
  },
})
