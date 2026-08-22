// Ported from open-codex-computer-use (MIT) — see LICENSE in this directory.
import AppKit
import Foundation
import AXComputerKit

final class MCPAppRuntime: NSObject, NSApplicationDelegate {
    private let server: StdioMCPServer
    private var runtimeError: Error?

    private init(server: StdioMCPServer) {
        self.server = server
    }

    @MainActor
    static func run(server: StdioMCPServer) throws {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)

        let delegate = MCPAppRuntime(server: server)
        application.delegate = delegate
        application.run()

        if let runtimeError = delegate.runtimeError {
            throw runtimeError
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Thread.detachNewThreadSelector(#selector(processStandardIO), toTarget: self, with: nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    @objc
    private func processStandardIO() {
        do {
            try server.run()
        } catch {
            runtimeError = error
        }

        DispatchQueue.main.async {
            NSApp.terminate(nil)
        }
    }
}
