const FILE_VERSION = 1
const MAX_PROMPT_TEXT_LENGTH = 200_000
const PROMPT_ID_PATTERN = /^[a-z0-9._-]{1,160}$/
const isVisiblePromptID = (id) => typeof id === "string" && id.endsWith(".visible")
const normalizePromptID = (id) => (typeof id === "string" ? id.trim() : "")

const overridesToMap = (value) => {
  const overrides = new Map()
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return overrides
  }

  for (const [key, entry] of Object.entries(value)) {
    if (!PROMPT_ID_PATTERN.test(key) || typeof entry !== "string") {
      continue
    }
    overrides.set(key, entry)
  }
  return overrides
}

const sanitizeOverrides = (value) => {
  return Object.fromEntries(overridesToMap(value))
}

const serializeState = (state) => {
  const overrides =
    state.overrides instanceof Map ? Object.fromEntries(state.overrides) : sanitizeOverrides(state.overrides)
  return {
    version: FILE_VERSION,
    overrides,
  }
}

export const createMagicPromptRuntime = (dependencies) => {
  const { fsPromises, path, filePath } = dependencies

  let writeLock = Promise.resolve()

  const readMutablePromptState = async () => {
    try {
      const raw = await fsPromises.readFile(filePath, "utf8")
      const parsed = JSON.parse(raw)
      const overrides = overridesToMap(parsed?.overrides)
      return {
        version: FILE_VERSION,
        overrides,
      }
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return { version: FILE_VERSION, overrides: new Map() }
      }
      console.warn("Failed to read magic prompts file:", error)
      return { version: FILE_VERSION, overrides: new Map() }
    }
  }

  const readPromptState = async () => serializeState(await readMutablePromptState())

  const writePromptState = async (state) => {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
    await fsPromises.writeFile(filePath, JSON.stringify(serializeState(state), null, 2), "utf8")
  }

  const persist = async (mutator) => {
    const run = async () => {
      const current = await readMutablePromptState()
      const next = await mutator(current)
      await writePromptState(next)
      return serializeState(next)
    }
    writeLock = writeLock.then(run, run)
    return writeLock
  }

  const setOverride = async (id, text) => {
    const normalizedId = normalizePromptID(id)
    if (!PROMPT_ID_PATTERN.test(normalizedId)) {
      throw new Error("Invalid prompt id")
    }
    if (typeof text !== "string") {
      throw new Error("Prompt text must be a string")
    }
    if (isVisiblePromptID(normalizedId) && text.trim().length === 0) {
      throw new Error("Visible prompt text cannot be empty")
    }
    if (text.length > MAX_PROMPT_TEXT_LENGTH) {
      throw new Error("Prompt text is too long")
    }

    return persist(async (state) => {
      const nextOverrides = new Map(state.overrides)
      nextOverrides.set(normalizedId, text)
      return {
        version: FILE_VERSION,
        overrides: nextOverrides,
      }
    })
  }

  const resetOverride = async (id) => {
    const normalizedId = normalizePromptID(id)
    if (!PROMPT_ID_PATTERN.test(normalizedId)) {
      throw new Error("Invalid prompt id")
    }

    return persist(async (state) => {
      if (!state.overrides.has(normalizedId)) {
        return state
      }
      const nextOverrides = new Map(state.overrides)
      nextOverrides.delete(normalizedId)
      return {
        version: FILE_VERSION,
        overrides: nextOverrides,
      }
    })
  }

  const resetAllOverrides = async () => {
    return persist(async () => ({ version: FILE_VERSION, overrides: new Map() }))
  }

  return {
    readPromptState,
    setOverride,
    resetOverride,
    resetAllOverrides,
  }
}
