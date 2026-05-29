import { assertBridgeSender, parseBridgeCommand, type BridgeCommandName, type BridgeSender } from "./schema"

export type DesktopBridgeInvoke = <TName extends BridgeCommandName>(name: TName, payload: unknown) => Promise<unknown>

export type RendererDesktopBridge = {
  invoke<TName extends BridgeCommandName>(name: TName, payload: unknown): Promise<unknown>
}

export function createRendererDesktopBridge(invoke: DesktopBridgeInvoke): RendererDesktopBridge {
  return {
    invoke(name, payload) {
      const command = parseBridgeCommand(name, payload)
      return invoke(command.name, command.payload)
    },
  }
}

export function assertTrustedRendererBridgeCall(sender: BridgeSender, name: BridgeCommandName, payload: unknown) {
  assertBridgeSender(sender)
  return parseBridgeCommand(name, payload)
}
