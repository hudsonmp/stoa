import SwiftUI

struct LibraryView: View {
    @Environment(StoaAPI.self) private var api
    @State private var items: [Item] = []
    @State private var loading = true
    @State private var selectedStatus = "to_read"
    @State private var error: String?

    private let statuses = ["to_read", "reading", "read"]
    private let statusLabels = ["To Read": "to_read", "Reading": "reading", "Read": "read"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Status picker
                Picker("Status", selection: $selectedStatus) {
                    Text("To Read").tag("to_read")
                    Text("Reading").tag("reading")
                    Text("Read").tag("read")
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)

                if loading {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else if items.isEmpty {
                    Spacer()
                    Text("No items")
                        .font(.system(.body, design: .serif))
                        .foregroundStyle(.secondary)
                    Spacer()
                } else {
                    List(items) { item in
                        NavigationLink(value: item) {
                            ItemRowView(item: item)
                        }
                    }
                    .listStyle(.plain)
                    .navigationDestination(for: Item.self) { item in
                        ItemDetailRouter(item: item)
                    }
                }
            }
            .navigationTitle("Library")
            .navigationBarTitleDisplayMode(.large)
            .task { await loadItems() }
            .onChange(of: selectedStatus) { _, _ in
                Task { await loadItems() }
            }
            .refreshable { await loadItems() }
        }
    }

    private func loadItems() async {
        loading = true
        do {
            items = try await api.getItems(status: selectedStatus)
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

/// Routes from the library list to the appropriate detail screen. For now:
/// paper/pdf items resolve to the reader (if the vault has been synced),
/// everything else falls back to a placeholder. Tier 2 can add web viewing
/// for non-PDF types.
struct ItemDetailRouter: View {
    let item: Item

    @State private var pdfURL: URL?
    @State private var vaultURL: URL?
    @State private var status: String = "Searching iCloud vault…"

    var body: some View {
        Group {
            if let pdfURL, let vaultURL {
                PdfReaderView(
                    pdfURL: pdfURL,
                    itemID: item.id,
                    vaultURL: vaultURL,
                    title: item.title
                )
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text(status)
                        .font(.system(.footnote, design: .serif))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            }
        }
        .task { await resolve() }
    }

    private func resolve() async {
        // Look up the PDF path by walking every project vault's
        // `.stoa/items/<item_id>.json` until one matches.
        guard (item.type == "paper" || item.type == "pdf") else {
            status = "Only PDFs are supported in the reader (type=\(item.type))."
            return
        }
        guard let docs = FolderStore.documentsURL() else {
            status = "iCloud is not available. Sign into iCloud Drive and try again."
            return
        }

        // The Mac daemon may not have mirrored yet. Iterate each subdirectory
        // (= project) and ask the ItemResolver to look up item_id.
        let fm = FileManager.default
        let projectDirs: [URL] = (try? fm.contentsOfDirectory(
            at: docs, includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles])) ?? []
        for project in projectDirs where project.hasDirectoryPath {
            // Fast path: scan this project's items manifest directly.
            let itemsDir = FolderStore.itemsManifestDir(vault: project)
            let itemJSON = itemsDir.appendingPathComponent("\(item.id).json")
            if FolderStore.isNotDownloaded(itemJSON) {
                FolderStore.requestDownload(itemJSON)
            }
            guard let data = try? Data(contentsOf: itemJSON),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let path = obj["path"] as? String
            else { continue }
            let candidate = project.appendingPathComponent(path)
            self.pdfURL = candidate
            self.vaultURL = project
            return
        }
        status = """
        Could not find \"\(item.title)\" in any synced vault. Make sure a \
        Mac folder-sync daemon has written this project's vault to \
        iCloud Drive.
        """
    }
}

struct ItemRowView: View {
    let item: Item

    private var typeIcon: String {
        switch item.type {
        case "paper": return "doc.text"
        case "book": return "book"
        case "blog": return "doc.richtext"
        case "video": return "play.rectangle"
        case "podcast": return "headphones"
        case "tweet": return "bubble.left"
        default: return "bookmark"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: typeIcon)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.system(.body, design: .serif))
                    .lineLimit(2)

                if let domain = item.domain {
                    Text(domain)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
