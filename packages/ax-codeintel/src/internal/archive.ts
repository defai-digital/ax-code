import path from "path"
import { Process } from "./process"

export namespace Archive {
  export async function extractZip(zipPath: string, destDir: string) {
    if (process.platform === "win32") {
      // PowerShell single-quoted strings escape a literal quote by doubling it.
      // Without this, a path containing an apostrophe (common on Windows, e.g.
      // a user folder like "O'Brien") would prematurely close the string and
      // break the command — or allow injection.
      const psQuote = (value: string) => value.replace(/'/g, "''")
      const winZipPath = psQuote(path.resolve(zipPath))
      const winDestDir = psQuote(path.resolve(destDir))
      // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
      const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`
      await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
      return
    }

    await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
  }
}
