"use strict"

const MAX_DESKTOP_WINDOW_TITLE_LENGTH = 160

const sanitizeDesktopWindowTitle = (value) => {
  if (typeof value !== "string") return ""
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DESKTOP_WINDOW_TITLE_LENGTH)
}

module.exports = {
  MAX_DESKTOP_WINDOW_TITLE_LENGTH,
  sanitizeDesktopWindowTitle,
}
