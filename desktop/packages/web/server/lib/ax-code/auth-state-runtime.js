export const createAxCodeAuthStateRuntime = (dependencies) => {
  // Password ownership (SPEC-2026-08-29-desktop-process-model-collapse §2 D2 /
  // §5 S2.2): under the Electron desktop shell, the main process generates the
  // per-boot runtime Basic-auth password and injects it here via
  // AX_CODE_SERVER_PASSWORD (surfaced as getUserProvidedPassword(), source
  // "user-env"), so this runtime adopts it and never generates or rotates.
  // Only in standalone (non-Electron) mode with no env password does this
  // module fall back to generating — and rotating — a managed password itself.
  const {
    crypto,
    process,
    getAuthPassword,
    setAuthPassword,
    getAuthSource,
    setAuthSource,
    getUserProvidedPassword,
    syncToHmrState,
  } = dependencies

  const normalizeAxCodePassword = (value) => {
    if (typeof value !== "string") {
      return ""
    }
    return value.trim()
  }

  const isValidAxCodePassword = (password) => normalizeAxCodePassword(password).length > 0

  const generateSecureAxCodePassword = () =>
    crypto.randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")

  const setAxCodeAuthState = (password, source) => {
    const normalized = normalizeAxCodePassword(password)
    if (!isValidAxCodePassword(normalized)) {
      setAuthPassword(null)
      setAuthSource(null)
      delete process.env.AX_CODE_SERVER_PASSWORD
      syncToHmrState()
      return null
    }

    setAuthPassword(normalized)
    setAuthSource(source)
    process.env.AX_CODE_SERVER_PASSWORD = normalized
    syncToHmrState()
    return normalized
  }

  const getAxCodeAuthHeaders = () => {
    const password = normalizeAxCodePassword(getAuthPassword() || process.env.AX_CODE_SERVER_PASSWORD || "")

    if (!password) {
      return {}
    }

    const credentials = Buffer.from(`ax-code:${password}`).toString("base64")
    return { Authorization: `Basic ${credentials}` }
  }

  const isAxCodeConnectionSecure = () => {
    const password = normalizeAxCodePassword(getAuthPassword() || process.env.AX_CODE_SERVER_PASSWORD || "")
    return isValidAxCodePassword(password)
  }

  const ensureLocalAxCodeServerPassword = async ({ rotateManaged = false } = {}) => {
    // Env-injected password (Electron main per boot, or a user export) always
    // wins — including over rotateManaged and over any HMR-restored password.
    const userProvidedPassword = getUserProvidedPassword()
    if (isValidAxCodePassword(userProvidedPassword)) {
      return setAxCodeAuthState(userProvidedPassword, "user-env")
    }

    if (rotateManaged) {
      const rotatedPassword = setAxCodeAuthState(generateSecureAxCodePassword(), "rotated")
      console.log("Rotated secure password for managed local ax-code instance")
      return rotatedPassword
    }

    const currentPassword = getAuthPassword()
    const currentSource = getAuthSource()
    if (isValidAxCodePassword(currentPassword)) {
      return setAxCodeAuthState(currentPassword, currentSource || "generated")
    }

    const generatedPassword = setAxCodeAuthState(generateSecureAxCodePassword(), "generated")
    console.log("Generated secure password for managed local ax-code instance")
    return generatedPassword
  }

  return {
    getAxCodeAuthHeaders,
    isAxCodeConnectionSecure,
    ensureLocalAxCodeServerPassword,
  }
}
