import { cmd } from "../cmd"
import { GithubInstallCommand } from "./install"
import { GithubRunCommand } from "./run"

export { parseGitHubRemote, extractResponseText, formatPromptTooLargeError } from "./types"

export {
  formatGitHubAgentToolTitle,
  formatGitHubAgentFailureMessage,
  formatGitHubAgentPermissionCheckFailureMessage,
  formatGitHubAgentExistingPrCheckWarning,
  parseGitHubRunContextText,
} from "./run"

export const GithubCommand = cmd({
  command: "github",
  describe: "manage GitHub agent",
  builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
  async handler() {},
})
