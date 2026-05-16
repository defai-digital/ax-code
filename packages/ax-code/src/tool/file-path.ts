import path from "path"

export const NULL_BYTE_PATH_ERROR = "File path contains null byte"

export function resolveToolFilePath(filePath: string, baseDirectory: string) {
  if (filePath.includes("\x00")) {
    throw new Error(NULL_BYTE_PATH_ERROR)
  }
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDirectory, filePath)
}
