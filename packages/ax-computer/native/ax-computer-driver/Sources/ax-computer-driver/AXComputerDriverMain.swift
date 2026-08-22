// Ported from open-codex-computer-use (MIT) — see LICENSE in this directory.
import AppKit
import Darwin
import Foundation
import AXComputerKit

@main
enum AXComputerDriverMain {
    @MainActor
    static func main() {
        do {
            try run()
        } catch let error as AXComputerCLIError {
            writeToStandardError(error.errorDescription ?? error.message)
            exit(EXIT_FAILURE)
        } catch let error as ComputerUseError {
            writeToStandardError(error.errorDescription ?? String(describing: error))
            exit(EXIT_FAILURE)
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            writeToStandardError(message)
            exit(EXIT_FAILURE)
        }
    }

    @MainActor
    private static func run() throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        let command = try parseAXComputerCLI(arguments: arguments)

        switch command {
        case .mcp:
            let service = ComputerUseService()
            let server = StdioMCPServer(service: service)
            if VisualCursorSupport.isEnabled {
                try MainActor.assumeIsolated {
                    try MCPAppRuntime.run(server: server)
                }
            } else {
                try server.run()
            }
        case .doctor:
            let permissions = PermissionDiagnostics.current()
            print(permissions.summary)
            if !permissions.missingPermissions.isEmpty {
                writeToStandardError(
                    "Missing permissions: \(permissions.missingPermissions.map(\.title).joined(separator: ", ")). " +
                        "Grant them in System Settings > Privacy & Security, then re-run doctor."
                )
            }
        case .listApps:
            let service = ComputerUseService()
            print(service.listApps().primaryText ?? "")
        case let .snapshot(app, textLimit, treeLimits):
            let service = ComputerUseService()
            print(try service.getAppState(app: app, textLimit: textLimit, treeLimits: treeLimits).primaryText ?? "")
        case let .call(invocation):
            if VisualCursorSupport.isEnabled {
                _ = NSApplication.shared.setActivationPolicy(.accessory)
            }
            let output = try runAXComputerCall(invocation)
            print(try output.jsonText())
            if output.hasToolError {
                exit(EXIT_FAILURE)
            }
        case let .help(command):
            print(axComputerHelpText(command: command))
        case .version:
            print(resolvedAXComputerVersion())
        }
    }

    private static func writeToStandardError(_ message: String) {
        guard let data = (message + "\n").data(using: .utf8) else {
            return
        }

        FileHandle.standardError.write(data)
    }
}
