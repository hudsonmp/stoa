import SwiftUI

/// SwiftUI form shown in the share sheet.
struct ShareView: View {
    let url: String
    let title: String
    let onSave: () -> Void
    let onCancel: () -> Void

    @State private var selectedType = "blog"
    @State private var selectedCollectionId: String?
    @State private var note = ""
    @State private var collections: [ShareCollection] = []
    @State private var saving = false
    @State private var saved = false
    @State private var error: String?

    private let types = ["blog", "paper", "book", "video", "podcast", "page"]

    var body: some View {
        NavigationStack {
            Form {
                // URL preview
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(.system(.body, design: .serif))
                            .lineLimit(2)
                        Text(url)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }

                // Type picker
                Section("Type") {
                    Picker("Type", selection: $selectedType) {
                        ForEach(types, id: \.self) { t in
                            Text(t.capitalized).tag(t)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                // Collection
                Section("Collection") {
                    Picker("Collection", selection: $selectedCollectionId) {
                        Text("None").tag(nil as String?)
                        ForEach(collections) { col in
                            Text(col.name).tag(col.id as String?)
                        }
                    }
                }

                // Quick note
                Section("Note") {
                    TextField("Quick note...", text: $note, axis: .vertical)
                        .lineLimit(3...6)
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Save to Stoa")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saved {
                        Label("Saved", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    } else {
                        Button("Save") { save() }
                            .disabled(saving)
                    }
                }
            }
            .task { await loadCollections() }
            .onAppear { autoDetectType() }
        }
    }

    private func autoDetectType() {
        let lower = url.lowercased()
        if lower.contains("arxiv.org") || lower.contains("doi.org") || lower.contains("semanticscholar") {
            selectedType = "paper"
        } else if lower.contains("youtube.com") || lower.contains("youtu.be") {
            selectedType = "video"
        } else if lower.contains("twitter.com") || lower.contains("x.com") {
            selectedType = "page"
        } else if lower.contains("podcasts.apple.com") || lower.contains("open.spotify.com/episode") {
            selectedType = "podcast"
        }
    }

    private func loadCollections() async {
        guard let token = KeychainHelper.read(.accessToken) ?? KeychainHelper.read(.userId) else { return }

        var request = URLRequest(url: URL(string: "\(StoaConstants.apiURL)/items/collections")!)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if KeychainHelper.read(.accessToken) != nil {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else {
            request.setValue(token, forHTTPHeaderField: "X-User-Id")
        }

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            let result = try JSONDecoder().decode(ShareCollectionsResponse.self, from: data)
            collections = result.collections
        } catch {
            // Collections are optional
        }
    }

    private func save() {
        saving = true
        Task {
            do {
                var body: [String: Any] = [
                    "url": url,
                    "type": selectedType,
                    "tags": [],
                    "person_ids": [],
                ]
                if let cid = selectedCollectionId { body["collection_id"] = cid }

                let jsonData = try JSONSerialization.data(withJSONObject: body)

                guard let token = KeychainHelper.read(.accessToken) ?? KeychainHelper.read(.userId) else {
                    error = "Not authenticated"
                    saving = false
                    return
                }

                var request = URLRequest(url: URL(string: "\(StoaConstants.apiURL)/ingest")!)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                if KeychainHelper.read(.accessToken) != nil {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                } else {
                    request.setValue(token, forHTTPHeaderField: "X-User-Id")
                }
                request.httpBody = jsonData

                let (_, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse, http.statusCode < 400 else {
                    error = "Save failed"
                    saving = false
                    return
                }

                saved = true
                // Haptic
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.success)

                // Auto-dismiss after brief delay
                try? await Task.sleep(for: .milliseconds(600))
                onSave()
            } catch {
                self.error = error.localizedDescription
                saving = false
            }
        }
    }
}

// MARK: - Types

struct ShareCollection: Codable, Identifiable {
    let id: String
    let name: String
}

private struct ShareCollectionsResponse: Codable {
    let collections: [ShareCollection]
}
