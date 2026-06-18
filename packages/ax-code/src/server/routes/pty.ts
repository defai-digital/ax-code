import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { Pty } from "@/pty"
import { NotFoundError } from "../../storage/db"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Log } from "@/util/log"
import { PTY_ID_PARAM, withPtyID } from "./route-params"

const log = Log.create({ service: "server.pty" })

export function parsePtyReconnectCursor(value: string | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed || !/^(?:-1|\d+)$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < -1) return undefined
  return parsed
}

export const PtyRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List PTY sessions",
        description: "Get a list of all active pseudo-terminal (PTY) sessions managed by ax-code.",
        operationId: "pty.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Pty.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Pty.list())
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create PTY session",
        description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
        operationId: "pty.create",
        responses: {
          200: {
            description: "Created session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Pty.CreateInput),
      async (c) => {
        const info = await Pty.create(c.req.valid("json"))
        return c.json(info)
      },
    )
    .get(
      "/:ptyID",
      describeRoute({
        summary: "Get PTY session",
        description: "Retrieve detailed information about a specific pseudo-terminal (PTY) session.",
        operationId: "pty.get",
        responses: {
          200: {
            description: "Session info",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", PTY_ID_PARAM),
      withPtyID(async (ptyID, c) => {
        const info = await Pty.get(ptyID)
        if (!info) {
          throw new NotFoundError({ message: "Session not found" })
        }
        return c.json(info)
      }),
    )
    .put(
      "/:ptyID",
      describeRoute({
        summary: "Update PTY session",
        description: "Update properties of an existing pseudo-terminal (PTY) session.",
        operationId: "pty.update",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", PTY_ID_PARAM),
      validator("json", Pty.UpdateInput),
      withPtyID(async (ptyID, c) => {
        const info = await Pty.update(ptyID, c.req.valid("json"))
        return c.json(info)
      }),
    )
    .delete(
      "/:ptyID",
      describeRoute({
        summary: "Remove PTY session",
        description: "Remove and terminate a specific pseudo-terminal (PTY) session.",
        operationId: "pty.remove",
        responses: {
          200: {
            description: "Session removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", PTY_ID_PARAM),
      withPtyID(async (ptyID, c) => {
        await Pty.remove(ptyID)
        return c.json(true)
      }),
    )
    .get(
      "/:ptyID/connect",
      describeRoute({
        summary: "Connect to PTY session",
        description: "Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.",
        operationId: "pty.connect",
        responses: {
          200: {
            description: "Connected session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", PTY_ID_PARAM),
      withPtyID((id) =>
        upgradeWebSocket(async (c) => {
          const cursor = parsePtyReconnectCursor(c.req.query("cursor"))
          let handler: Awaited<ReturnType<typeof Pty.connect>>
          if (!(await Pty.get(id))) throw new NotFoundError({ message: "Session not found" })

          type Socket = {
            readyState: number
            send: (data: string | Uint8Array | ArrayBuffer) => void
            close: (code?: number, reason?: string) => void
          }

          const isSocket = (value: unknown): value is Socket => {
            if (!value || typeof value !== "object") return false
            if (!("readyState" in value)) return false
            if (!("send" in value) || typeof (value as { send?: unknown }).send !== "function") return false
            if (!("close" in value) || typeof (value as { close?: unknown }).close !== "function") return false
            return typeof (value as { readyState?: unknown }).readyState === "number"
          }

          const pending: string[] = []
          let ready = false
          let closed = false

          return {
            async onOpen(_event, ws) {
              const socket = ws.raw
              if (!isSocket(socket)) {
                ws.close()
                return
              }
              try {
                handler = await Pty.connect(id, socket, cursor)
                if (closed) {
                  handler?.onClose()
                  return
                }
                ready = true
                for (const msg of pending) handler?.onMessage(msg)
                pending.length = 0
              } catch (error) {
                log.error("PTY connection failed", { id, error })
                pending.length = 0
                ws.close()
              }
            },
            onMessage(event) {
              if (typeof event.data !== "string") return
              if (!ready) {
                pending.push(event.data)
                return
              }
              handler?.onMessage(event.data)
            },
            onClose() {
              if (closed) return
              closed = true
              handler?.onClose()
            },
            onError() {
              if (closed) return
              closed = true
              handler?.onClose()
            },
          }
        }),
      ),
    ),
)
