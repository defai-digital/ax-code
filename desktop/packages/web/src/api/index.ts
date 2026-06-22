import type { RuntimeAPIs } from "@openchamber/ui/api/types"
import { createWebTerminalAPI } from "./terminal"
import { createWebGitAPI } from "./git"
import { createWebFilesAPI } from "./files"
import { createWebSettingsAPI } from "./settings"
import { createWebPermissionsAPI } from "./permissions"
import { createWebNotificationsAPI } from "./notifications"
import { createWebToolsAPI } from "./tools"
import { createWebGitHubAPI } from "./github"
import { HTTP_DEFAULTS } from "./constants"

export const createWebAPIs = (): RuntimeAPIs => ({
  runtime: { platform: HTTP_DEFAULTS.runtime.web, isDesktop: false, label: HTTP_DEFAULTS.runtime.web },
  terminal: createWebTerminalAPI(),
  git: createWebGitAPI(),
  files: createWebFilesAPI(),
  settings: createWebSettingsAPI(),
  permissions: createWebPermissionsAPI(),
  notifications: createWebNotificationsAPI(),
  github: createWebGitHubAPI(),
  tools: createWebToolsAPI(),
})
