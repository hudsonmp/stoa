// swift-tools-version: 5.9
// NOTE: This Package.swift is for code validation only.
// The actual Xcode project should be created via Xcode:
//   File → New → Project → iOS App (SwiftUI)
//   Then add a Share Extension target.
//
// This package lets `swift build` verify the Swift code compiles.

import PackageDescription

let package = Package(
    name: "Stoa",
    platforms: [.iOS(.v17)],
    targets: [
        .executableTarget(
            name: "Stoa",
            path: "Stoa",
            sources: ["StoaApp.swift", "Models/Item.swift",
                      "Services/StoaAPI.swift", "Services/AuthService.swift",
                      "Views/LibraryView.swift", "Views/LoginView.swift",
                      "Views/SettingsView.swift"]
        ),
    ]
)
