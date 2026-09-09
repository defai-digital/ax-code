/** Win32 device aliases apply to every component, including names with extensions. */
export namespace WindowsSnapshotPaths {
  export function enabled(): boolean {
    return process.platform === "win32"
  }

  export function unsupported(file: string): boolean {
    return file.split(/[\\/]/).some((component) => {
      if (/[ .]$/.test(component)) return true
      const stem = component.split(".", 1)[0].replace(/ +$/, "")
      return /^(?:CON|PRN|AUX|NUL|(?:COM|LPT)[1-9¹²³])$/i.test(stem)
    })
  }

  export function select(output: string): string[] {
    return [...new Set(output.split("\0").filter((file) => file && unsupported(file)))].sort()
  }
}
