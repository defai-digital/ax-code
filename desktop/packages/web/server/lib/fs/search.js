import { mapCoreFindFilesToSearchEntries } from "./core-file-adapter.js"

export const createFsSearchRuntime = ({ coreFileAdapter, path }) => {
  const searchFilesystemFiles = async (rootPath, options = {}) => {
    if (!coreFileAdapter || typeof coreFileAdapter.search !== "function") {
      const error = new Error("AX Code core file API is not ready")
      error.code = "ENOTREADY"
      throw error
    }
    const query = typeof options.query === "string" ? options.query : ""
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 50
    const hits = await coreFileAdapter.search({
      query,
      directory: rootPath,
      limit,
      type: "file",
    })
    return mapCoreFindFilesToSearchEntries(rootPath, hits, path)
  }

  return {
    searchFilesystemFiles,
  }
}
