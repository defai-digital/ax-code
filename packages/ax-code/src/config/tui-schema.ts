import z from "zod"
import { Config } from "./config"

const KeybindOverride = z
  .object(
    Object.fromEntries(Object.keys(Config.Keybinds.shape).map((key) => [key, z.string().optional()])) as Record<
      string,
      z.ZodOptional<z.ZodString>
    >,
  )
  .strict()

export const TuiNotifications = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe(
      "Emit a terminal-native notification (OSC 9, BEL fallback) when a turn completes, a permission is requested, or a question is asked (default true)",
    ),
  sound: z
    .enum(["off", "chime", "speak"])
    .optional()
    .describe(
      "Audio notification alongside terminal notifications: 'chime' plays a short system sound, 'speak' reads a templated phrase aloud (default off). Has no effect unless notifications.enabled is true",
    ),
  voice: z.string().optional().describe("Voice for 'speak' sound (empty or omitted uses the platform default voice)"),
  rate: z
    .number()
    .int()
    .optional()
    .describe(
      "Speech rate for 'speak' sound in words per minute (0 or omitted uses the platform default; clamped to 1..500 where the backend supports it)",
    ),
  events: z
    .object({
      permission: z.boolean().optional().describe("Play sound when a permission approval is requested (default true)"),
      question: z.boolean().optional().describe("Play sound when the agent asks a question (default true)"),
      complete: z.boolean().optional().describe("Play sound when a turn completes (default false)"),
      error: z.boolean().optional().describe("Play sound when a session error occurs (default true)"),
    })
    .optional()
    .describe("Per-event sound toggles; apply to both chime and speak"),
})

export const TuiOptions = z.object({
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  idle_recap: z
    .object({
      enabled: z.boolean().optional().describe("Show a short recap banner after an idle turn (default true)"),
      delay_ms: z
        .number()
        .min(1000)
        .optional()
        .describe("Idle delay before the recap is generated, in milliseconds (default 5000, min 1000)"),
      pregenerate: z
        .boolean()
        .optional()
        .describe(
          "Start generating the recap inside the idle window so it can display at the delay mark (default true)",
        ),
    })
    .optional()
    .describe("Idle recap settings"),
  notifications: TuiNotifications.optional().describe("Terminal notification settings"),
  status_line: z
    .object({
      command: z
        .string()
        .optional()
        .describe(
          "Shell command whose first stdout line is rendered in the TUI status line. Receives a JSON snapshot (model, cwd, session id, version, ...) on stdin.",
        ),
      interval_ms: z
        .number()
        .min(500)
        .optional()
        .describe("Status line refresh interval in milliseconds (default 3000, min 500)"),
    })
    .optional()
    .describe("Custom status line settings"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverride.optional(),
  })
  .extend(TuiOptions.shape)
  .strict()
