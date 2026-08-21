/**
 * ax-code VSCode Extension
 *
 * Sidebar agent panel with file/selection context, code-block actions
 * (copy / insert at cursor / open in file), and terminal launcher.
 * Uses the Programmatic SDK for direct agent communication.
 */

import * as vscode from "vscode"
import { ChatViewProvider } from "./chat-provider"
import { enrichPath, getConfig } from "./config"
import { TERMINAL_NAME, resolveAxCodeTarget, terminalLaunch, terminalLaunchEnv } from "./terminal-launch"

let chatProviderInstance: ChatViewProvider | null = null

export function activate(context: vscode.ExtensionContext) {
  // Register chat panel in sidebar
  const chatProvider = new ChatViewProvider(context)
  chatProviderInstance = chatProvider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("ax-code.chatView", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  // Command: Open chat panel
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.openChat", () => {
      vscode.commands.executeCommand("ax-code.chatView.focus")
    }),
  )

  // Editor commands prefill the chat input instead of sending immediately, so
  // the user reviews and edits the prompt before it goes out.
  const prefill = async (text: string) => {
    try {
      await chatProvider.prefillInput(text)
    } catch (err: any) {
      vscode.window.showErrorMessage(`ax-code: ${err?.message ?? "failed to open chat"}`)
    }
  }

  // Command: Ask about current file
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.askAboutFile", async () => {
      const fileRef = getActiveFileContext()
      if (!fileRef) {
        vscode.window.showWarningMessage("No file is currently open")
        return
      }
      await prefill(`Explain ${fileRef.relativePath}${fileRef.selection ?? ""}`)
    }),
  )

  // Command: Fix current file
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.fixFile", async () => {
      const fileRef = getActiveFileContext()
      if (!fileRef) {
        vscode.window.showWarningMessage("No file is currently open")
        return
      }
      await prefill(`Fix any issues in ${fileRef.relativePath}${fileRef.selection ?? ""}`)
    }),
  )

  // Command: Explain selection
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.explainSelection", async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage("No text selected")
        return
      }
      const selectedText = editor.document.getText(editor.selection)
      const fileName = vscode.workspace.asRelativePath(editor.document.uri)
      await prefill(`Explain this code from ${fileName}:\n\`\`\`\n${selectedText}\n\`\`\``)
    }),
  )

  // Command: Review selection
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.reviewSelection", async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage("No text selected")
        return
      }
      const selectedText = editor.document.getText(editor.selection)
      const fileName = vscode.workspace.asRelativePath(editor.document.uri)
      await prefill(`Review this code from ${fileName} for bugs and improvements:\n\`\`\`\n${selectedText}\n\`\`\``)
    }),
  )

  // Command: Insert a reference to the current file (optionally with the
  // selection's line range) into the chat input.
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.insertFileReference", async () => {
      const fileRef = getActiveFileContext()
      if (!fileRef) {
        vscode.window.showWarningMessage("No file is currently open")
        return
      }
      try {
        await chatProvider.insertTextAtInput(`@${fileRef.relativePath}${fileRef.selection ?? ""}`)
      } catch (err: any) {
        vscode.window.showErrorMessage(`ax-code: ${err?.message ?? "failed to open chat"}`)
      }
    }),
  )

  // Resolve the same launch target the chat backend uses (axCode.binaryPath →
  // monorepo dev → PATH) so the terminal never disagrees with the chat panel.
  const createAxCodeTerminal = () => {
    const target = resolveAxCodeTarget({
      binaryPath: getConfig().binaryPath,
      extensionPath: context.extensionPath,
    })
    const launch = terminalLaunch(target)
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/logo/activity-icon.png")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/logo/activity-icon.png")),
      },
      location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      env: {
        PATH: enrichPath(process.env.PATH ?? ""),
        AX_CODE_CALLER: "vscode",
        ...terminalLaunchEnv(target),
      },
      ...(launch.kind === "direct" ? { shellPath: launch.shellPath, shellArgs: launch.shellArgs } : {}),
    })
    terminal.show()
    if (launch.kind === "shell") {
      terminal.sendText(launch.command)
    }
  }

  // Command: Open in terminal (legacy, kept for compatibility)
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.openTerminal", async () => {
      // Also adopt terminals created by older versions, which used the
      // lowercase "ax-code" or hyphenated "AX-Code" names.
      const existingTerminal = vscode.window.terminals.find(
        (t) => t.name === TERMINAL_NAME || t.name === "ax-code" || t.name === "AX-Code",
      )
      if (existingTerminal) {
        existingTerminal.show()
        return
      }
      createAxCodeTerminal()
    }),
  )

  // Command: Open new terminal
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.openNewTerminal", async () => {
      createAxCodeTerminal()
    }),
  )

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.text = "$(hubot) AX Code"
  statusBar.tooltip = "Open AX Code chat"
  statusBar.command = "ax-code.openChat"
  statusBar.show()
  context.subscriptions.push(statusBar)
}

export function deactivate() {
  if (chatProviderInstance) {
    chatProviderInstance.dispose()
    chatProviderInstance = null
  }
}

function getActiveFileContext(): { relativePath: string; selection?: string } | null {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    return null
  }

  const document = editor.document
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
  if (!workspaceFolder) {
    return null
  }

  const relativePath = vscode.workspace.asRelativePath(document.uri)
  let selection: string | undefined

  if (!editor.selection.isEmpty) {
    const startLine = editor.selection.start.line + 1
    const endLine = editor.selection.end.line + 1
    selection = startLine === endLine ? `#L${startLine}` : `#L${startLine}-${endLine}`
  }

  return { relativePath, selection }
}
