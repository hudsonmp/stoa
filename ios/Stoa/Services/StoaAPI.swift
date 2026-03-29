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
}

// MARK: - Response types

private struct ItemsResponse: Codable { let items: [Item] }
private struct CollectionsResponse: Codable { let collections: [Collection] }
private struct IngestResponse: Codable { let item: Item }

enum StoaError: LocalizedError {
    case api(String)
    var errorDescription: String? {
        switch self {
        case .api(let msg): return msg
        }
    }
}
