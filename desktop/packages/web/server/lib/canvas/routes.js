import { CanvasValidationError } from "./validation.js"
import { readCanvasDocument, writeCanvasDocument } from "./store.js"

const sendRouteError = (res, error, fallbackMessage) => {
  if (error instanceof CanvasValidationError) {
    return res.status(error.statusCode).json({ error: error.message })
  }
  return res.status(500).json({ error: error?.message || fallbackMessage })
}

export function registerCanvasRoutes(app, dependencies) {
  const { fsPromises, path, resolveProjectDirectory } = dependencies

  app.get("/api/canvas", async (req, res) => {
    try {
      const resolved = await resolveProjectDirectory(req)
      if (!resolved.directory) {
        return res.status(400).json({ error: resolved.error || "Project directory is required" })
      }

      const result = await readCanvasDocument({
        fsPromises,
        path,
        projectDirectory: resolved.directory,
      })
      return res.json(result)
    } catch (error) {
      return sendRouteError(res, error, "Failed to read canvas")
    }
  })

  app.put("/api/canvas", async (req, res) => {
    try {
      const resolved = await resolveProjectDirectory(req)
      if (!resolved.directory) {
        return res.status(400).json({ error: resolved.error || "Project directory is required" })
      }

      const document = req.body?.document
      const result = await writeCanvasDocument({
        fsPromises,
        path,
        projectDirectory: resolved.directory,
        document,
      })
      return res.json(result)
    } catch (error) {
      return sendRouteError(res, error, "Failed to save canvas")
    }
  })
}
