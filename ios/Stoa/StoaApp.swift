import SwiftUI

@main
struct StoaApp: App {
    @State private var auth = AuthService()
    @State private var api = StoaAPI()

    var body: some Scene {
        WindowGroup {
            if auth.isAuthenticated {
                ContentView()
                    .environment(auth)
                    .environment(api)
                    .onOpenURL { url in
                        handleURL(url)
                    }
            } else {
                LoginView()
                    .environment(auth)
            }
        }
    }

    /// Handle stoa://save?url=... from Action Button Shortcut
    private func handleURL(_ url: URL) {
        guard url.scheme == "stoa",
              url.host == "save",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let itemURL = components.queryItems?.first(where: { $0.name == "url" })?.value
        else { return }

        Task {
            do {
                _ = try await api.ingest(url: itemURL)
                // Haptic feedback
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.success)
            } catch {
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.error)
            }
        }
    }
}

struct ContentView: View {
    var body: some View {
        TabView {
            LibraryView()
                .tabItem {
                    Label("Library", systemImage: "books.vertical")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
    }
}
