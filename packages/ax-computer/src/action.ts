export type MouseButton = "left" | "right" | "middle"

/**
 * Point coordinates are screenshot pixel coordinates of the provider's most
 * recent observation; the provider maps them into its backend's coordinate
 * space. Element ids come from that same observation's `elements` list.
 */
export type ComputerTarget = { kind: "element"; id: string } | { kind: "point"; x: number; y: number }

/**
 * Condition a `wait` action polls for — never an arbitrary sleep. The
 * element conditions take element-kind targets only (a pixel has no
 * visibility/enabled/value state; WaitConditionSchema enforces this at
 * runtime). `screen_stable` has no target and resolves when the observed
 * content stops changing between polls.
 */
export type WaitCondition =
  | { type: "element_visible"; target: ComputerTarget }
  | { type: "element_enabled"; target: ComputerTarget }
  | { type: "value_matches"; target: ComputerTarget; value: string }
  | { type: "screen_stable" }

export type ComputerAction =
  | { type: "click"; target: ComputerTarget; button?: MouseButton; count?: number }
  | { type: "type"; text: string }
  | { type: "keypress"; keys: string[] }
  | { type: "scroll"; target?: ComputerTarget; direction: "up" | "down" | "left" | "right"; amount?: number }
  | { type: "drag"; from: ComputerTarget; to: ComputerTarget }
  | { type: "set_value"; target: ComputerTarget; value: string }
  | { type: "activate_window"; windowId: string }
  | { type: "launch_app"; app: string }
  | { type: "move"; target: ComputerTarget }
  | {
      type: "wait"
      condition: WaitCondition
      /** ms before an unmet condition fails the wait (default 10_000) */
      timeoutMs?: number
      /** poll interval in ms (default 250, floor 100) */
      pollMs?: number
    }

/**
 * Per-step outcome of a batch ax_act call. Flat on purpose — ActionResult
 * must not become recursive. Batches are ordered and bounded but NOT atomic
 * (UI effects cannot be rolled back), and when stopOnError is not false the
 * steps after the first refusal never run and are absent from the list.
 */
export interface ActStepResult {
  index: number
  ok: boolean
  /** backend refusal code carried verbatim */
  refusal?: string
  detail?: string
}

export interface ActionResult {
  ok: boolean
  provider: string
  /** action type; batch calls report the first step's type here */
  action: ComputerAction["type"]
  detail?: string
  /** backend refusal code carried verbatim (e.g. cua's `background_unavailable`) */
  refusal?: string
  /** per-step outcomes, present only for batch calls */
  results?: ActStepResult[]
}
