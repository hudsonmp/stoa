import Foundation

enum StoaConstants {
    static let appGroupID = "group.com.stoa.shared"
    static let keychainAccessGroup = "com.stoa.shared"

    // Default to local dev; overridden in Settings
    static var apiURL: String {
        let shared = UserDefaults(suiteName: appGroupID)
        return shared?.string(forKey: "apiURL") ?? "https://stoa-backend-production-9116.up.railway.app"
    }

    static var webappURL: String {
        let shared = UserDefaults(suiteName: appGroupID)
        return shared?.string(forKey: "webappURL") ?? "https://webapp-cvtbw8lu2-hudsonmp10.vercel.app"
    }

    // Supabase config (for Apple Sign-In → Supabase auth)
    static let supabaseURL = "https://nhttyppkcajodocrnqhi.supabase.co"
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder"
}
