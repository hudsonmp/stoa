import Foundation

struct Item: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let url: String?
    let type: String
    let domain: String?
    let faviconUrl: String?
    let readingStatus: String?
    let summary: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, url, type, domain, summary
        case faviconUrl = "favicon_url"
        case readingStatus = "reading_status"
        case createdAt = "created_at"
    }

    static func == (lhs: Item, rhs: Item) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct Collection: Codable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let itemCount: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case itemCount = "item_count"
    }
}
