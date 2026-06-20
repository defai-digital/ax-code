export type IPty = {
  pid: number
  process: string
  onData: (handler: (data: string) => void) => { dispose: () => void }
  onExit: (handler: (event: { exitCode: number; signal?: number }) => void) => { dispose: () => void }
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
}

export function spawn(): IPty {
  throw new Error("PTY is not available in the Windows Node bundled runtime")
}
