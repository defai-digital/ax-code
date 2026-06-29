type PluginFileReadResult = { content: string } | null

export type PluginFileLoadResult = { ok: true; content: string } | { ok: false; error?: unknown }

export const loadPluginFileContent = async (
  fileId: string,
  readFile: (id: string) => Promise<PluginFileReadResult>,
): Promise<PluginFileLoadResult> => {
  try {
    const result = await readFile(fileId)
    return result ? { ok: true, content: result.content } : { ok: false }
  } catch (error) {
    return { ok: false, error }
  }
}
