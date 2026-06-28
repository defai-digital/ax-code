import crypto from "node:crypto"
import { CanvasValidationError, createDefaultCanvasDocument, sanitizeCanvasDocument } from "./validation.js"

const CANVAS_DIR_NAME = ".ax-code/canvas"
const CANVAS_FILE_NAME = "main.canvas.json"

export const getCanvasPaths = ({ path, projectDirectory }) => {
  const canvasDir = path.join(projectDirectory, CANVAS_DIR_NAME)
  return {
    canvasDir,
    assetsDir: path.join(canvasDir, "assets"),
    documentPath: path.join(canvasDir, CANVAS_FILE_NAME),
  }
}

export const readCanvasDocument = async ({ fsPromises, path, projectDirectory }) => {
  const paths = getCanvasPaths({ path, projectDirectory })
  try {
    const raw = await fsPromises.readFile(paths.documentPath, "utf8")
    const parsed = JSON.parse(raw)
    return {
      document: sanitizeCanvasDocument(parsed),
      path: paths.documentPath,
      recoveredFromInvalid: false,
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new CanvasValidationError(`Stored canvas document is invalid: ${error?.message || "Unknown error"}`)
    }
    return {
      document: createDefaultCanvasDocument(),
      path: paths.documentPath,
      recoveredFromInvalid: false,
    }
  }
}

export const writeCanvasDocument = async ({ fsPromises, path, projectDirectory, document }) => {
  const paths = getCanvasPaths({ path, projectDirectory })
  const sanitized = sanitizeCanvasDocument(document)
  const tempPath = `${paths.documentPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`

  await fsPromises.mkdir(paths.canvasDir, { recursive: true })
  await fsPromises.mkdir(paths.assetsDir, { recursive: true })

  try {
    await fsPromises.writeFile(tempPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8")
    await fsPromises.rename(tempPath, paths.documentPath)
  } catch (error) {
    try {
      await fsPromises.unlink(tempPath)
    } catch {}
    throw error
  }

  return {
    document: sanitized,
    path: paths.documentPath,
  }
}
