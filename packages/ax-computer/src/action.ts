export type MouseButton = "left" | "right" | "middle"

/**
 * Point coordinates are screenshot pixel coordinates of the provider's most
 * recent observation; the provider maps them into its backend's coordinate
 * space. Element ids come from that same observation's `elements` list.
 */
export type ComputerTarget = { kind: "element"; id: string } | { kind: "point"; x: number; y: number }

export type ComputerAction =
  | { type: "click"; target: ComputerTarget; button?: MouseButton; count?: number }
  | { type: "type"; text: string }
  | { type: "keypress"; keys: string[] }
  | { type: "scroll"; target?: ComputerTarget; direction: "up" | "down" | "left" | "right"; amount?: number }
  | { type: "drag"; from: ComputerTarget; to: ComputerTarget }
  | { type: "set_value"; target: ComputerTarget; value: string }
  | { type: "activate_window"; windowId: string }
  | { type: "launch_app"; app: string }

export interface ActionResult {
  ok: boolean
  provider: string
  action: ComputerAction["type"]
  detail?: string
  /** backend refusal code carried verbatim (e.g. cua's `background_unavailable`) */
  refusal?: string
}
