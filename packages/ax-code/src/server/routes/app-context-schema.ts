import z from "zod"

const AppContextFile = z.object({
  name: z.string(),
  path: z.string(),
  exists: z.boolean(),
  scope: z.enum(["project", "global"]),
})

export const AppContextMemory = z.object({
  exists: z.boolean(),
  totalTokens: z.number(),
  lastUpdated: z.string(),
  contentHash: z.string(),
  sections: z.array(z.string()),
})

export const AppContextTemplate = z.object({
  key: z.enum(["repo-rules", "dir-rules", "review-checklist", "frontend-style-guide", "release-checklist"]),
  title: z.string(),
  description: z.string(),
  path: z.string(),
  exists: z.boolean(),
  kind: z.enum(["instruction", "checklist"]),
})

const AppContextCheck = z.object({
  id: z.string(),
  title: z.string(),
  command: z.string(),
  cwd: z.string(),
  source: z.enum(["root", "directory"]),
})

export const AppContextInfo = z.object({
  directory: z.string(),
  worktree: z.string(),
  files: z.array(AppContextFile),
  instructions: z.array(AppContextFile),
  templates: z.array(AppContextTemplate),
  checks: z.array(AppContextCheck),
  memory: AppContextMemory.nullable(),
})

export const AppContextTemplateRequest = z.object({
  key: AppContextTemplate.shape.key,
})

export type AppContextTemplateData = Omit<z.infer<typeof AppContextTemplate>, "exists">
export type AppContextCheckData = z.infer<typeof AppContextCheck>
export type AppContextTemplateKey = z.infer<typeof AppContextTemplateRequest>["key"]
