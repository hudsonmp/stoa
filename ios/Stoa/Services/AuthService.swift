import AuthenticationServices
import Foundation

/// Apple Sign-In → Supabase auth flow.
@Observable
final class AuthService {
    var isAuthenticated = false
    var userId: String?

    init() {
        // Check for existing session
        if let token = KeychainHelper.read(.accessToken),
           let uid = KeychainHelper.read(.userId) {
            isAuthenticated = true
            userId = uid
        }
    }

    /// Handle Apple Sign-In credential and exchange with Supabase.
    func handleAppleSignIn(credential: ASAuthorizationAppleIDCredential) async throws {
        guard let identityTokenData = credential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8) else {
            throw AuthError.noIdentityToken
        }

        // Exchange Apple identity token for Supabase session
        let url = URL(string: "\(StoaConstants.supabaseURL)/auth/v1/token?grant_type=id_token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(StoaConstants.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue(StoaConstants.supabaseAnonKey, forHTTPHeaderField: "apikey")

        let body: [String: Any] = [
            "provider": "apple",
            "id_token": identityToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode < 400 else {
            let msg = String(data: data, encoding: .utf8) ?? "Auth failed"
            throw AuthError.supabaseError(msg)
        }

        let session = try JSONDecoder().decode(SupabaseSession.self, from: data)

        // Store in Keychain (shared with extension)
        KeychainHelper.save(.accessToken, value: session.accessToken)
        KeychainHelper.save(.refreshToken, value: session.refreshToken)
        KeychainHelper.save(.userId, value: session.user.id)

        isAuthenticated = true
        userId = session.user.id
    }

    func signOut() {
        KeychainHelper.deleteAll()
        isAuthenticated = false
        userId = nil
    }

    /// Refresh the access token if expired.
    func refreshIfNeeded() async {
        guard let refreshToken = KeychainHelper.read(.refreshToken) else { return }

        let url = URL(string: "\(StoaConstants.supabaseURL)/auth/v1/token?grant_type=refresh_token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(StoaConstants.supabaseAnonKey, forHTTPHeaderField: "apikey")

        let body = ["refresh_token": refreshToken]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode < 400 else { return }
            let session = try JSONDecoder().decode(SupabaseSession.self, from: data)
            KeychainHelper.save(.accessToken, value: session.accessToken)
            KeychainHelper.save(.refreshToken, value: session.refreshToken)
        } catch {
            // Refresh failed — user will need to re-authenticate
        }
    }
}

// MARK: - Types

enum AuthError: LocalizedError {
    case noIdentityToken
    case supabaseError(String)

    var errorDescription: String? {
        switch self {
        case .noIdentityToken: return "No identity token from Apple"
        case .supabaseError(let msg): return msg
        }
    }
}

struct SupabaseSession: Codable {
    let accessToken: String
    let refreshToken: String
    let user: SupabaseUser

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case user
    }
}

struct SupabaseUser: Codable {
    let id: String
    let email: String?
}
