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
                        ItemRowView(item: item)
                    }
                    .listStyle(.plain)
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
