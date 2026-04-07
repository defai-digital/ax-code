/**
 * ax-code VSCode Extension
 *
 * Full chat panel with agent support, file context, and inline edits.
 * Uses the Programmatic SDK for direct agent communication.
 */

import * as vscode from "vscode"
import { ChatViewProvider } from "./chat-provider"

const TERMINAL_NAME = "ax-code"

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

  // Command: Ask about current file
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.askAboutFile", async () => {
      const fileRef = getActiveFileContext()
      if (!fileRef) {
        vscode.window.showWarningMessage("No file is currently open")
        return
      }
      chatProvider.sendMessage(`Explain ${fileRef.relativePath}`)
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
      chatProvider.sendMessage(`Fix any issues in ${fileRef.relativePath}`)
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
      chatProvider.sendMessage(`Explain this code from ${fileName}:\n\`\`\`\n${selectedText}\n\`\`\``)
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
      chatProvider.sendMessage(`Review this code from ${fileName} for bugs and improvements:\n\`\`\`\n${selectedText}\n\`\`\``)
    }),
  )

  // Command: Open in terminal (legacy, kept for compatibility)
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.openTerminal", async () => {
      const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
      if (existingTerminal) {
        existingTerminal.show()
        return
      }
      const terminal = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        iconPath: {
          light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
          dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
        },
        location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
        env: { AX_CODE_CALLER: "vscode" },
      })
      terminal.show()
      terminal.sendText("ax-code")
    }),
  )

  // Command: Open new terminal
  context.subscriptions.push(
    vscode.commands.registerCommand("ax-code.openNewTerminal", async () => {
      const terminal = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        iconPath: {
          light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
          dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
        },
        location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
        env: { AX_CODE_CALLER: "vscode" },
      })
      terminal.show()
      terminal.sendText("ax-code")
    }),
  )

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.text = "$(hubot) ax-code"
  statusBar.tooltip = "Open ax-code chat"
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
  if (!editor) return null

  const document = editor.document
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
  if (!workspaceFolder) return null

  const relativePath = vscode.workspace.asRelativePath(document.uri)
  let selection: string | undefined

  if (!editor.selection.isEmpty) {
    const startLine = editor.selection.start.line + 1
    const endLine = editor.selection.end.line + 1
    selection = startLine === endLine ? `#L${startLine}` : `#L${startLine}-${endLine}`
  }

  return { relativePath: relativePath + (selection ?? ""), selection }
}
