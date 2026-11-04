// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-native-shell",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-native-shell",
      type: .static,
      targets: ["tauri-plugin-native-shell"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-native-shell",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
