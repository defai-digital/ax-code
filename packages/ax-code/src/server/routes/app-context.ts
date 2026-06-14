import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import { NamedError } from "@ax-code/util/error"
import { Filesystem } from "@/util/filesystem"
import { InstructionPrompt } from "@/session/instruction"
import * as MemoryStore from "@/memory/store"
import { getMetadata as getMemoryMetadata } from "@/memory/injector"
import { generate as generateMemory } from "@/memory/generator"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { contextChecks } from "./app-context-checks"
import { contextTemplates, templateBody } from "./app-context-templates"
import { AppContextInfo, AppContextMemory, AppContextTemplate, AppContextTemplateRequest } from "./app-context-schema"
import path from "path"
import z from "zod"

export const AppContextRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get project context",
        description: "Get instruction-file and cached-memory metadata for the current project context.",
        operationId: "app.context",
        responses: {
          200: {
            description: "Current project context information",
            content: {
              "application/json": {
                schema: resolver(AppContextInfo),
              },
            },
          },
        },
      }),
      async (c) => {
        const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
        const scope = (p: string) => {
          if (Filesystem.contains(root, p)) return "project"
          if (Filesystem.contains(Instance.directory, p)) return "project"
          return "global"
        }
        const names = ["AGENTS.md", "CLAUDE.md"]
        const files = await Promise.all(
          names.map(async (name) => {
            const found = (await Filesystem.findUp(name, Instance.directory, root))[0]
            const file = found ?? path.join(root, name)
            return {
              name,
              path: file,
              exists: !!found,
              scope: scope(file),
            }
          }),
        )
        const instructions = Array.from(await InstructionPrompt.systemPaths())
          .sort((a, b) => a.localeCompare(b))
          .map((file) => ({
            name: path.basename(file),
            path: file,
            exists: true,
            scope: scope(file),
          }))
        const templates = await Promise.all(
          contextTemplates({ root, dir: Instance.directory }).map(async (item) => ({
            ...item,
            exists: await Filesystem.exists(item.path),
          })),
        )
        const memory = await getMemoryMetadata(root)
        const checks = await contextChecks({ root, dir: Instance.directory })
        return c.json({
          directory: Instance.directory,
          worktree: root,
          files,
          instructions,
          templates,
          checks,
          memory,
        })
      },
    )
    .post(
      "/template",
      describeRoute({
        summary: "Create project context template",
        description: "Create a recommended rules or checklist file for the current project context.",
        operationId: "app.contextTemplateCreate",
        responses: {
          200: {
            description: "Template file metadata",
            content: {
              "application/json": {
                schema: resolver(AppContextTemplate),
              },
            },
          },
        },
      }),
      validator("json", AppContextTemplateRequest),
      async (c) => {
        const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
        const dir = Instance.directory
        const key = c.req.valid("json").key
        const item = contextTemplates({ root, dir }).find((template) => template.key === key)
        if (!item) {
          throw new NamedError.Unknown({
            message: `Unknown project context template: ${key}`,
          })
        }

        if (!(await Filesystem.exists(item.path))) {
          await Filesystem.write(item.path, templateBody({ key, root, dir }))
        }

        return c.json({
          ...item,
          exists: true,
        })
      },
    )
    .post(
      "/memory/warmup",
      describeRoute({
        summary: "Refresh project memory",
        description: "Generate and cache fresh project memory for the current context.",
        operationId: "app.contextMemoryWarmup",
        responses: {
          200: {
            description: "Refreshed project memory metadata",
            content: {
              "application/json": {
                schema: resolver(AppContextMemory),
              },
            },
          },
        },
      }),
      async (c) => {
        const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
        const memory = await generateMemory(root, {
          maxTokens: 4000,
          depth: 3,
        })
        await MemoryStore.save(root, memory)
        return c.json({
          exists: true,
          totalTokens: memory.totalTokens,
          lastUpdated: memory.updated,
          contentHash: memory.contentHash,
          sections: Object.keys(memory.sections).filter((key) => {
            const section = memory.sections[key as keyof typeof memory.sections]
            return !!section && section.tokens > 0
          }),
        })
      },
    )
    .delete(
      "/memory",
      describeRoute({
        summary: "Clear project memory",
        description: "Delete cached project memory for the current context.",
        operationId: "app.contextMemoryClear",
        responses: {
          200: {
            description: "Whether cached memory was cleared",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
        return c.json(await MemoryStore.clear(root))
      },
    ),
)
