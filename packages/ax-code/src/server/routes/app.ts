import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Vcs } from "@/project/vcs"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Capability } from "@/capability"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { lazy } from "@/util/lazy"
import { errors } from "../error"
import z from "zod"

function clean(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()
}

const EXTRA_MAX_DEPTH = 5
const EXTRA_MAX_KEYS = 50

function cleanExtra(value: unknown, depth = 0): unknown {
  if (depth > EXTRA_MAX_DEPTH) return "[truncated]"
  if (typeof value === "string") return clean(value)
  if (Array.isArray(value)) return value.slice(0, EXTRA_MAX_KEYS).map((v) => cleanExtra(v, depth + 1))
  if (value && typeof value === "object") {
    const entries = Object.entries(value).slice(0, EXTRA_MAX_KEYS)
    return Object.fromEntries(entries.map(([key, item]) => [clean(key), cleanExtra(item, depth + 1)]))
  }
  return value
}

export const AppRoutes = lazy(() =>
  new Hono()
    .post(
      "/instance/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose the current ax-code instance, releasing all resources.",
        operationId: "instance.dispose",
        responses: {
          200: {
            description: "Instance disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.dispose()
        return c.json(true)
      },
    )
    .post(
      "/instance/restart",
      describeRoute({
        summary: "Restart instance",
        description: "Dispose and reinitialize the ax-code instance, reloading all configuration and provider data.",
        operationId: "instance.restart",
        responses: {
          200: {
            description: "Instance restarted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.reload({
          directory: Instance.directory,
          init: InstanceBootstrap,
        })
        return c.json(true)
      },
    )
    .get(
      "/path",
      describeRoute({
        summary: "Get paths",
        description: "Retrieve the current working directory and related path information for the ax-code instance.",
        operationId: "path.get",
        responses: {
          200: {
            description: "Path",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      home: z.string(),
                      state: z.string(),
                      config: z.string(),
                      worktree: z.string(),
                      directory: z.string(),
                    })
                    .meta({
                      ref: "Path",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: Instance.worktree,
          directory: Instance.directory,
        })
      },
    )
    .get(
      "/vcs",
      describeRoute({
        summary: "Get VCS info",
        description: "Retrieve version control system (VCS) information for the current project, such as git branch.",
        operationId: "vcs.get",
        responses: {
          200: {
            description: "VCS info",
            content: {
              "application/json": {
                schema: resolver(Vcs.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const branch = await Vcs.branch()
        return c.json({
          branch,
        })
      },
    )
    .get(
      "/command",
      describeRoute({
        summary: "List commands",
        description: "Get a list of all available commands in the ax-code system.",
        operationId: "command.list",
        responses: {
          200: {
            description: "List of commands",
            content: {
              "application/json": {
                schema: resolver(Command.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const commands = await Command.list()
        return c.json(commands)
      },
    )
    .get(
      "/capability",
      describeRoute({
        summary: "List capabilities",
        description: "Get a unified catalog of reusable commands, skills, agents, and workflow templates.",
        operationId: "capability.list",
        responses: {
          200: {
            description: "List of capabilities",
            content: {
              "application/json": {
                schema: resolver(Capability.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const capabilities = await Capability.list()
        return c.json(capabilities)
      },
    )
    .post(
      "/log",
      describeRoute({
        summary: "Write log",
        description: "Write a log entry to the server logs with specified level and metadata.",
        operationId: "app.log",
        responses: {
          200: {
            description: "Log entry written successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          service: z
            .string()
            .max(64)
            .regex(/^[a-zA-Z0-9._-]+$/)
            .meta({ description: "Service name for the log entry" }),
          level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
          message: z.string().max(10000).meta({ description: "Log message" }),
          extra: z
            .record(z.string(), z.any())
            .optional()
            .meta({ description: "Additional metadata for the log entry" }),
        }),
      ),
      async (c) => {
        const { service, level, message, extra } = c.req.valid("json")
        const logger = Log.create({ service })
        const text = clean(message)
        const metadata = {
          source: "client",
          ...(extra ? { extra: cleanExtra(extra) } : {}),
        }

        switch (level) {
          case "debug":
            logger.debug(text, metadata)
            break
          case "info":
            logger.info(text, metadata)
            break
          case "error":
            logger.error(text, metadata)
            break
          case "warn":
            logger.warn(text, metadata)
            break
        }

        return c.json(true)
      },
    )
    .get(
      "/agent",
      describeRoute({
        summary: "List agents",
        description: "Get a list of all available AI agents in the ax-code system.",
        operationId: "app.agents",
        responses: {
          200: {
            description: "List of agents",
            content: {
              "application/json": {
                schema: resolver(Agent.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const modes = await Agent.list()
        return c.json(modes)
      },
    ),
)
