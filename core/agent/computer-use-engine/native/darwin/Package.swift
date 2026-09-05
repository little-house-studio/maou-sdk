// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "computer-use-helper",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(name: "computer-use-helper", targets: ["ComputerUseHelper"]),
    ],
    dependencies: [
        .package(url: "https://github.com/openclaw/AXorcist.git", revision: "aa07d72fbb1861b56f5833b4cff8d9101c8dfbb3"),
    ],
    targets: [
        .executableTarget(
            name: "ComputerUseHelper",
            dependencies: [
                .product(name: "AXorcist", package: "AXorcist"),
            ],
            path: "Sources/ComputerUseHelper"
        ),
    ]
)
