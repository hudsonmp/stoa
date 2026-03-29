import SwiftUI

struct SettingsView: View {
    @Environment(AuthService.self) private var auth
    @Environment(StoaAPI.self) private var api

    @State private var apiURL: String = StoaConstants.apiURL
    @State private var backendStatus: Bool?

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    if let uid = auth.userId {
                        HStack {
                            Text("User ID")
                            Spacer()
                            Text(String(uid.prefix(8)) + "...")
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button("Sign Out", role: .destructive) {
                        auth.signOut()
                    }
                }

                Section("Backend") {
                    TextField("API URL", text: $apiURL)
                        .font(.system(.body, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit {
                            let shared = UserDefaults(suiteName: StoaConstants.appGroupID)
                            shared?.set(apiURL, forKey: "apiURL")
                        }

                    HStack {
                        Text("Status")
                        Spacer()
                        if let status = backendStatus {
                            Circle()
                                .fill(status ? .green : .red)
                                .frame(width: 8, height: 8)
                            Text(status ? "Connected" : "Unreachable")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                }

                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
            .task {
                backendStatus = await api.healthCheck()
            }
        }
    }
}
