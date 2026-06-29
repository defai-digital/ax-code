"use strict"

const DESKTOP_INVOKE_COMMAND_PATTERN = /^desktop_[A-Za-z0-9_]+$/

const isAllowedDesktopInvokeCommand = (command) => {
  return typeof command === "string" && DESKTOP_INVOKE_COMMAND_PATTERN.test(command)
}

module.exports = {
  isAllowedDesktopInvokeCommand,
}
