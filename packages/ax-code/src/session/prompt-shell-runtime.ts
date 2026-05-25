import path from "path"

export type ShellOutputState = {
  output: string
  outputBytes: number
  outputTruncated: boolean
}

export function appendShellOutputChunk(
  state: ShellOutputState,
  chunk: Buffer | string,
  hardCap: number,
): ShellOutputState {
  const text = typeof chunk === "string" ? chunk : chunk.toString()
  if (!text || state.outputTruncated) return state

  const chunkBytes = Buffer.byteLength(text, "utf-8")
  if (state.outputBytes + chunkBytes <= hardCap) {
    return {
      ...state,
      output: state.output + text,
      outputBytes: state.outputBytes + chunkBytes,
    }
  }

  let end = text.length
  const remaining = hardCap - state.outputBytes
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf-8") > remaining) {
    end--
  }

  let output = state.output
  let outputBytes = state.outputBytes
  if (end > 0) {
    const slice = text.slice(0, end)
    output += slice
    outputBytes += Buffer.byteLength(slice, "utf-8")
  }

  return {
    output: output + "\n\n[output truncated at 10MB]",
    outputBytes,
    outputTruncated: true,
  }
}

export function shellOutputMetadata(state: ShellOutputState) {
  return {
    output: state.output,
    description: "",
    outputTruncated: state.outputTruncated,
  }
}

function shellKey(shell: string, platform = process.platform) {
  const name = platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
  return name.toLowerCase()
}

export function shellArgs(shell: string, command: string, platform = process.platform) {
  const name = shellKey(shell, platform)
  const args: Record<string, string[]> = {
    nu: ["-c", command],
    fish: ["-c", command],
    zsh: [
      "-c",
      "-l",
      `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(command)}
          `,
    ],
    bash: [
      "-c",
      "-l",
      `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(command)}
          `,
    ],
    cmd: ["/c", command],
    powershell: ["-NoProfile", "-Command", command],
    pwsh: ["-NoProfile", "-Command", command],
    "": ["-c", command],
  }

  return args[name] ?? args[""]
}
