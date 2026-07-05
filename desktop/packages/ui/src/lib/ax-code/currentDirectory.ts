import { axCodeClient } from "./client"

export const getAxCodeCurrentDirectory = (): string | null => {
  const directory = axCodeClient.getDirectory()
  return typeof directory === "string" && directory.trim().length > 0 ? directory : null
}
