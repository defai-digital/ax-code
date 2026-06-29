"use strict"

function buildDesktopOpenDialogOptions(options) {
  const input = options && typeof options === "object" ? options : {}
  const properties = []
  if (input.directory === true) {
    properties.push("openDirectory")
  } else {
    properties.push("openFile")
  }
  if (input.multiple === true) {
    properties.push("multiSelections")
  }

  const dialogOptions = { properties }

  if (typeof input.title === "string" && input.title.trim()) {
    dialogOptions.title = input.title.trim()
  }
  if (typeof input.defaultPath === "string" && input.defaultPath.trim()) {
    dialogOptions.defaultPath = input.defaultPath.trim()
  }
  if (Array.isArray(input.filters)) {
    dialogOptions.filters = input.filters
      .filter(
        (filter) =>
          filter &&
          typeof filter.name === "string" &&
          Array.isArray(filter.extensions) &&
          filter.extensions.every((extension) => typeof extension === "string" && extension.trim().length > 0),
      )
      .map((filter) => ({
        name: filter.name,
        extensions: filter.extensions.map((extension) => extension.trim()),
      }))
  }

  return dialogOptions
}

function resolveDesktopDialogOwnerWindow(BrowserWindow, event, fallbackWindow) {
  const senderOwner =
    BrowserWindow && typeof BrowserWindow.fromWebContents === "function" && event?.sender
      ? BrowserWindow.fromWebContents(event.sender)
      : null
  if (senderOwner && typeof senderOwner.isDestroyed === "function" && !senderOwner.isDestroyed()) {
    return senderOwner
  }
  return fallbackWindow && typeof fallbackWindow.isDestroyed === "function" && !fallbackWindow.isDestroyed()
    ? fallbackWindow
    : undefined
}

module.exports = {
  buildDesktopOpenDialogOptions,
  resolveDesktopDialogOwnerWindow,
}
