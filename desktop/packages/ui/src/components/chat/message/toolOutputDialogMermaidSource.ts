const MALFORMED_DATA_URL_ERROR = "Malformed data URL"

export const decodeMermaidDataUrl = (value: string): string => {
  const commaIndex = value.indexOf(",")
  if (commaIndex < 0) {
    throw new Error(MALFORMED_DATA_URL_ERROR)
  }

  const metadata = value.slice(0, commaIndex).toLowerCase()
  const payload = value.slice(commaIndex + 1)

  try {
    if (metadata.includes(";base64")) {
      return atob(payload)
    }
    return decodeURIComponent(payload)
  } catch {
    throw new Error(MALFORMED_DATA_URL_ERROR)
  }
}

export const loadMermaidDataUrlSource = (value: string): Promise<string> => {
  return Promise.resolve().then(() => decodeMermaidDataUrl(value))
}
