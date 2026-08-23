// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "AXComputerDriver",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "AXComputerKit",
            targets: ["AXComputerKit"]
        ),
        .executable(
            name: "ax-computer-driver",
            targets: ["ax-computer-driver"]
        ),
    ],
    targets: [
        .target(
            name: "AXComputerKit",
            path: "Sources/AXComputerKit"
        ),
        .executableTarget(
            name: "ax-computer-driver",
            dependencies: ["AXComputerKit"],
            path: "Sources/ax-computer-driver"
        ),
        .testTarget(
            name: "AXComputerKitTests",
            dependencies: ["AXComputerKit"],
            path: "Tests/AXComputerKitTests"
        ),
    ]
)
