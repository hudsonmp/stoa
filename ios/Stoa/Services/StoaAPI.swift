import Foundation

/// Stoa API client. All calls go through the FastAPI backend.
@Observable
final class StoaAPI {
    var isAuthenticated: Bool { KeychainHelper.read(.accessToken) != nil }

    private var baseURL: String { StoaConstants.apiURL }

    private func authHeaders() -> [String: String] {
        var headers = ["Content-Type": "application/json"]
        if let token = KeychainHelper.read(.accessToken) {
            headers["Authorization"] = "Bearer \(token)"
        } else if let userId = KeychainHelper.read(.userId) {
            headers["X-User-Id"] = userId
        }
        return headers
    }

    private func request(_ method: String, path: String, body: Data? = nil) async throws -> Data {
        var req = URLRequest(url: URL(string: "\(baseURL)\(path)")!)
        req.httpMethod = method
        for (k, v) in authHeaders() { req.setValue(v, forHTTPHeaderField: k) }
        if let body { req.httpBody = body }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode < 400 else {
            throw StoaError.api(String(data: data, encoding: .utf8) ?? "Unknown error")
        }
        return data
    }

    // MARK: - Items

    func getItems(status: String = "to_read") async throws -> [Item] {
        let data = try await request("GET", path: "/items?status=\(status)")
        let result = try JSONDecoder().decode(ItemsResponse.self, from: data)
        return result.items
    }

    func ingest(url: String, type: String = "blog", collectionId: String? = nil) async throws -> Item {
        var body: [String: Any] = ["url": url, "type": type, "tags": [], "person_ids": []]
        if let cid = collectionId { body["collection_id"] = cid }
        let jsonData = try JSONSerialization.data(withJSONObject: body)
        let data = try await request("POST", path: "/ingest", body: jsonData)
        let result = try JSONDecoder().decode(IngestResponse.self, from: data)
        return result.item
    }

    // MARK: - Highlights

    func createHighlight(itemId: String, text: String, color: String = "yellow", note: String? = nil, pageNumber: Int? = nil) async throws -> Highlight {
        var body: [String: Any] = [
            "item_id": itemId,
            "text": text,
            "color": color,
        ]
        if let note { body["note"] = note }
        if let pageNumber { body["page_number"] = pageNumber }
        let jsonData = try JSONSerialization.data(withJSONObject: body)
        let data = try await request("POST", path: "/highlights", body: jsonData)
        let result = try JSONDecoder().decode(HighlightResponse.self, from: data)
        return result.highlight
    }

    // MARK: - Books

    func getBooks() async throws -> [Item] {
        let data = try await request("GET", path: "/items?type=book")
        let result = try JSONDecoder().decode(ItemsResponse.self, from: data)
        return result.items
    }

    func searchItems(query: String) async throws -> [Item] {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let data = try await request("GET", path: "/items/quick-search?q=\(encoded)&limit=10")
        let result = try JSONDecoder().decode(QuickSearchResponse.self, from: data)
        return result.results
    }

    // MARK: - Collections

    func getCollections() async throws -> [Collection] {
        let data = try await request("GET", path: "/items/collections")
        let result = try JSONDecoder().decode(CollectionsResponse.self, from: data)
        return result.collections
    }

    // MARK: - Health

    func healthCheck() async -> Bool {
        do {
            _ = try await request("GET", path: "/health")
            return true
        } catch {
            return false
        }
    }

    // MARK: - Social (v2 — bidirectional friendships)

    func getMyProfile() async throws -> (Profile, Bool) {
        let data = try await request("GET", path: "/social/me")
        let res = try JSONDecoder().decode(MyProfileResponse.self, from: data)
        return (res.profile, res.needsSetup)
    }

    func setupProfile(username: String, displayName: String?, bio: String?) async throws -> Profile {
        var body: [String: Any] = ["username": username]
        if let dn = displayName { body["display_name"] = dn }
        if let b = bio { body["bio"] = b }
        let jsonData = try JSONSerialization.data(withJSONObject: body)
        let data = try await request("POST", path: "/social/setup", body: jsonData)
        return try JSONDecoder().decode(ProfileEnvelope.self, from: data).profile
    }

    func updateMyProfile(displayName: String?, bio: String?) async throws -> Profile {
        var body: [String: Any] = [:]
        if let dn = displayName { body["display_name"] = dn }
        if let b = bio { body["bio"] = b }
        let jsonData = try JSONSerialization.data(withJSONObject: body)
        let data = try await request("PATCH", path: "/social/me", body: jsonData)
        return try JSONDecoder().decode(ProfileEnvelope.self, from: data).profile
    }

    func getProfile(username: String) async throws -> ProfileView {
        let encoded = username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? username
        let data = try await request("GET", path: "/social/profile/\(encoded)")
        return try JSONDecoder().decode(ProfileView.self, from: data)
    }

    func getProfileItems(username: String) async throws -> [FriendBookshelfItem] {
        let encoded = username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? username
        let data = try await request("GET", path: "/social/profile/\(encoded)/items")
        return try JSONDecoder().decode(ProfileItemsResponse.self, from: data).items
    }

    func searchUsers(_ query: String) async throws -> [Profile] {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let data = try await request("GET", path: "/social/search?q=\(encoded)")
        return try JSONDecoder().decode(UsersResponse.self, from: data).users
    }

    func sendFriendRequest(username: String) async throws -> String {
        let body = try JSONSerialization.data(withJSONObject: ["username": username])
        let data = try await request("POST", path: "/social/friend-request", body: body)
        let res = try JSONDecoder().decode(FriendshipActionResponse.self, from: data)
        return res.friendshipState
    }

    func acceptFriendRequest(username: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["username": username])
        _ = try await request("POST", path: "/social/friend-accept", body: body)
    }

    func removeFriend(username: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["username": username])
        _ = try await request("POST", path: "/social/friend-remove", body: body)
    }

    func listFriends() async throws -> [Profile] {
        let data = try await request("GET", path: "/social/friends")
        return try JSONDecoder().decode(FriendsResponse.self, from: data).friends
    }

    func listIncomingRequests() async throws -> [PendingRequest] {
        let data = try await request("GET", path: "/social/friend-requests/incoming")
        return try JSONDecoder().decode(RequestsResponse.self, from: data).requests
    }

    func listOutgoingRequests() async throws -> [PendingRequest] {
        let data = try await request("GET", path: "/social/friend-requests/outgoing")
        return try JSONDecoder().decode(RequestsResponse.self, from: data).requests
    }

    func getFeed() async throws -> [FeedItem] {
        let data = try await request("GET", path: "/social/feed")
        return try JSONDecoder().decode(FeedResponse.self, from: data).feed
    }
}

// MARK: - Response types

private struct ItemsResponse: Codable { let items: [Item] }
private struct CollectionsResponse: Codable { let collections: [Collection] }
private struct IngestResponse: Codable { let item: Item }
private struct HighlightResponse: Codable { let highlight: Highlight }
private struct QuickSearchResponse: Codable { let results: [Item] }
private struct MyProfileResponse: Codable {
    let profile: Profile
    let needsSetup: Bool
    enum CodingKeys: String, CodingKey {
        case profile
        case needsSetup = "needs_setup"
    }
}
private struct ProfileEnvelope: Codable { let profile: Profile }
private struct ProfileItemsResponse: Codable { let items: [FriendBookshelfItem] }
private struct FriendsResponse: Codable { let friends: [Profile] }
private struct UsersResponse: Codable { let users: [Profile] }
private struct RequestsResponse: Codable { let requests: [PendingRequest] }
private struct FeedResponse: Codable { let feed: [FeedItem] }
private struct FriendshipActionResponse: Codable {
    let friendshipState: String
    enum CodingKeys: String, CodingKey {
        case friendshipState = "friendship_state"
    }
}

enum StoaError: LocalizedError {
    case api(String)
    var errorDescription: String? {
        switch self {
        case .api(let msg): return msg
        }
    }
}
