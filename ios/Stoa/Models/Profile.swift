import Foundation

struct Profile: Codable, Identifiable {
    let userId: String
    let username: String
    let displayName: String?
    let bio: String?
    let avatarUrl: String?
    let createdAt: String?

    var id: String { userId }

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case username
        case displayName = "display_name"
        case bio
        case avatarUrl = "avatar_url"
        case createdAt = "created_at"
    }

    var initial: String {
        String((displayName ?? username).prefix(1)).uppercased()
    }
}

struct ProfileView: Codable {
    let profile: Profile
    let friendCount: Int
    let friendshipState: String // none | pending_outgoing | pending_incoming | accepted | self

    enum CodingKeys: String, CodingKey {
        case profile
        case friendCount = "friend_count"
        case friendshipState = "friendship_state"
    }
}

struct FeedItem: Codable, Identifiable {
    let id: String
    let userId: String
    let action: String
    let itemId: String?
    let createdAt: String
    let username: String
    let displayName: String?
    let avatarUrl: String?
    let itemTitle: String?
    let itemUrl: String?
    let itemType: String?
    let itemDomain: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case action
        case itemId = "item_id"
        case createdAt = "created_at"
        case username
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case itemTitle = "item_title"
        case itemUrl = "item_url"
        case itemType = "item_type"
        case itemDomain = "item_domain"
    }

    var verb: String {
        switch action {
        case "save": return "saved"
        case "highlight": return "highlighted"
        case "finish": return "finished"
        case "recommend": return "recommended"
        case "note": return "noted"
        default: return action
        }
    }
}

struct PendingRequest: Codable, Identifiable {
    let userId: String
    let username: String
    let displayName: String?
    let avatarUrl: String?
    let bio: String?
    let requestedAt: String?

    var id: String { userId }

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case username
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case bio
        case requestedAt = "requested_at"
    }

    var initial: String {
        String((displayName ?? username).prefix(1)).uppercased()
    }

    var asProfile: Profile {
        Profile(userId: userId, username: username, displayName: displayName, bio: bio, avatarUrl: avatarUrl, createdAt: nil)
    }
}

struct FriendBookshelfItem: Codable, Identifiable {
    let id: String
    let title: String
    let url: String?
    let type: String
    let domain: String?
    let faviconUrl: String?
    let summary: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, url, type, domain, summary
        case faviconUrl = "favicon_url"
        case createdAt = "created_at"
    }
}
