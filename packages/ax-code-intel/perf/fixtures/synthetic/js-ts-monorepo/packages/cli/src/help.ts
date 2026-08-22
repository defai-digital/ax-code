import { APP_NAME, APP_VERSION } from "@perf/core"

export function helpText(): string {
  return `${APP_NAME} ${APP_VERSION} — usage: cli <command>`
}
