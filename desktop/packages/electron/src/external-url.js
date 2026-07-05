"use strict"

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"])

function hasUrlControlCharacter(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function normalizeSafeExternalUrl(value) {
  const target = typeof value === "string" ? value.trim() : ""
  if (!target) return null
  if (hasUrlControlCharacter(target)) return null
  try {
    const parsed = new URL(target)
    if (parsed.username || parsed.password) return null
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null
  } catch {
    return null
  }
}

module.exports = {
  normalizeSafeExternalUrl,
}
