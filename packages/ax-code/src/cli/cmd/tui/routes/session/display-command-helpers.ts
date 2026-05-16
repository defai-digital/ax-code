export const shareTitle = (url?: string) => (url ? "Copy share link" : "Share session")

export const transcriptFilename = (id: string) => `session-${id.slice(0, 8)}.md`
