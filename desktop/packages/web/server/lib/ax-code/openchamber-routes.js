export const registerOpenChamberRoutes = (app, dependencies) => {
  const {
    modelsDevApiUrl,
    modelsMetadataCacheTtl,
    fetchFreeZenModels,
    getCachedZenModels,
  } = dependencies

  let cachedModelsMetadata = null
  let cachedModelsMetadataTimestamp = 0

  app.get("/api/openchamber/models-metadata", async (_req, res) => {
    const now = Date.now()

    if (cachedModelsMetadata && now - cachedModelsMetadataTimestamp < modelsMetadataCacheTtl) {
      res.setHeader("Cache-Control", "public, max-age=60")
      return res.json(cachedModelsMetadata)
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null
    const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null

    try {
      const response = await fetch(modelsDevApiUrl, {
        signal: controller?.signal,
        headers: {
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        response.body?.cancel()
        throw new Error(`models.dev responded with status ${response.status}`)
      }

      const metadata = await response.json()
      cachedModelsMetadata = metadata
      cachedModelsMetadataTimestamp = Date.now()

      res.setHeader("Cache-Control", "public, max-age=300")
      res.json(metadata)
    } catch (error) {
      console.warn("Failed to fetch models.dev metadata via server:", error)

      if (cachedModelsMetadata) {
        res.setHeader("Cache-Control", "public, max-age=60")
        res.json(cachedModelsMetadata)
      } else {
        const statusCode = error?.name === "AbortError" ? 504 : 502
        res.status(statusCode).json({ error: "Failed to retrieve model metadata" })
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  })

  app.get("/api/zen/models", async (_req, res) => {
    try {
      const models = await fetchFreeZenModels()
      res.setHeader("Cache-Control", "public, max-age=300")
      res.json({ models })
    } catch (error) {
      console.warn("Failed to fetch zen models:", error)
      const cachedZenModels = getCachedZenModels()
      if (cachedZenModels) {
        res.setHeader("Cache-Control", "public, max-age=60")
        res.json(cachedZenModels)
      } else {
        const statusCode = error?.name === "AbortError" ? 504 : 502
        res.status(statusCode).json({ error: "Failed to retrieve zen models" })
      }
    }
  })
}
