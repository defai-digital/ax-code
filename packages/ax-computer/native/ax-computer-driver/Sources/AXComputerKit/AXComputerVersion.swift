// Ported from open-codex-computer-use (MIT) — see LICENSE in this directory.
import Foundation

public let axComputerVersion = "1.0.0"

public func resolvedAXComputerVersion(bundle: Bundle = .main) -> String {
    if let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
       !version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return version
    }

    return axComputerVersion
}
